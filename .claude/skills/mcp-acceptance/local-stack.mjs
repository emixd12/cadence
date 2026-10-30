#!/usr/bin/env node
// Isolated local stack for MCP acceptance (Tier 0 and Tier 1 rehearsals).
//
//   node .claude/skills/mcp-acceptance/local-stack.mjs up     [--name cadence-accept-run] [--db-base 56150] [--app-port 4450]
//   node .claude/skills/mcp-acceptance/local-stack.mjs status [--name …]
//   node .claude/skills/mcp-acceptance/local-stack.mjs down   [--name …]
//
// `up` (run from the repository worktree root, Node 24):
//  1. copies supabase/config.toml and seed.sql into a private /tmp workdir,
//     links the migrations, and moves the project ID and every port to
//     --db-base … --db-base+9;
//  2. starts a private Docker proxy that pins every published port to
//     127.0.0.1, then `supabase start` through it (Homebrew CLI), and stops
//     the stack again if any port is published on 0.0.0.0 or ::;
//  3. makes a private CA and a 127.0.0.1 certificate, and starts `next dev`
//     with HTTPS on --app-port with MCP and test login on;
//  4. writes <workdir>/runner.env (mode 0600) for the acceptance commands.
// Load it with: set -a; . "$(cat /tmp/<name>.workdir)/runner.env"; set +a
//
// Nothing here prints keys: `supabase start` output goes to a 0600 log that is
// deleted, and env files are 0600 inside the 0700 workdir. Never point this at
// habit-tracking-app (Emi's local data) or run it in Ticket 232's checkout.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const SUPABASE = process.env.CADENCE_SUPABASE_CLI ?? '/opt/homebrew/bin/supabase';
const DOCKER_SOCK = join(homedir(), '.docker', 'run', 'docker.sock');
const NAME = /^cadence-accept-[a-z0-9-]{1,40}$/;
const EXCLUDE = 'imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor,realtime,storage-api';
// Files `next dev` rewrites; restored on `down`.
const REWRITTEN = ['AGENTS.md', 'next-env.d.ts'];

const fail = (message) => { process.stderr.write(`local-stack: ${message}\n`); process.exit(1); };
const say = (message) => process.stdout.write(`${message}\n`);
const stateFile = (name) => `/tmp/${name}.workdir`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Port layout for one stack. Same offsets the wave 1–2 stacks used. */
export function portsFor(base) {
  return { shadow: base, api: base + 1, db: base + 2, studio: base + 3, mail: base + 4, analytics: base + 7, inspector: base + 8, pooler: base + 9 };
}

/** Rewrites the copied config.toml; every replacement must happen exactly once. */
export function rewriteConfig(text, { name, ports }) {
  const rules = [
    [/^project_id = "habit-tracking-app"$/m, `project_id = "${name}"`],
    [/^port = 55321$/m, `port = ${ports.api}`],
    [/^port = 55322$/m, `port = ${ports.db}`],
    [/^shadow_port = 55320$/m, `shadow_port = ${ports.shadow}`],
    [/^port = 55329$/m, `port = ${ports.pooler}`],
    [/^port = 55323$/m, `port = ${ports.studio}`],
    [/^port = 55324$/m, `port = ${ports.mail}`],
    [/^inspector_port = 8083$/m, `inspector_port = ${ports.inspector}`],
    [/^port = 55327$/m, `port = ${ports.analytics}`],
    [/^# signing_keys_path = "\.\/signing_keys\.json"$/m, 'signing_keys_path = "./signing_keys.json"'],
  ];
  let out = text;
  for (const [pattern, replacement] of rules) {
    if (!pattern.test(out)) throw new Error(`config.toml changed shape: ${pattern}`);
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** True when every published binding is on 127.0.0.1. `docker ps --format {{.Ports}}` lines. */
export function loopbackOnly(portLines) {
  return portLines.every((line) => line.split(',').map((p) => p.trim()).filter((p) => p.includes('->')).every((p) => p.startsWith('127.0.0.1:')));
}

// Private Docker proxy: only this project's containers, ports forced to 127.0.0.1, no host binds.
const proxySource = (name) => `import http from "node:http";
import net from "node:net";
import { chmodSync } from "node:fs";
const [listenPath, daemon] = process.argv.slice(2);
const PROJECT = ${JSON.stringify(name)};
const LABEL = "com.supabase.cli.project";
const fail = (res, why) => { console.error("rejected " + why); res.writeHead(403, { "content-type": "application/json" }); res.end('{"message":"rejected"}'); };
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  let body = Buffer.concat(chunks);
  const path = (req.url ?? "").split("?")[0].replace(/^\\/v\\d+\\.\\d+/, "");
  if (req.method === "POST" && path === "/containers/create") {
    let doc; try { doc = JSON.parse(body.toString()); } catch { return fail(res, "create-json"); }
    const label = doc.Labels?.[LABEL];
    if (label !== undefined && label !== PROJECT) return fail(res, "other-project");
    const host = doc.HostConfig ?? {};
    if (host.PublishAllPorts) return fail(res, "publish-all");
    const ports = host.PortBindings ?? {};
    if (Object.keys(ports).length && label !== PROJECT) return fail(res, "unlabelled-ports");
    for (const list of Object.values(ports)) for (const b of list ?? []) b.HostIp = "127.0.0.1";
    for (const bind of host.Binds ?? []) if (String(bind).startsWith("/") && !String(bind).startsWith("/var/run/docker.sock")) return fail(res, "host-bind");
    body = Buffer.from(JSON.stringify(doc));
  }
  const headers = { ...req.headers, "content-length": String(body.length) }; delete headers["transfer-encoding"];
  const up = http.request({ socketPath: daemon, path: req.url, method: req.method, headers }, (inc) => { res.writeHead(inc.statusCode ?? 502, inc.headers); inc.pipe(res); });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  up.end(body);
});
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(daemon, () => {
    up.write(req.method + " " + req.url + " HTTP/1.1\\r\\n" + Object.entries(req.headers).map(([k, v]) => k + ": " + v).join("\\r\\n") + "\\r\\n\\r\\n");
    if (head?.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
});
process.umask(0o077);
server.listen(listenPath, () => { chmodSync(listenPath, 0o600); console.log("proxy-ready"); });
for (const s of ["SIGINT", "SIGTERM"]) process.once(s, () => server.close(() => process.exit(0)));
`;

const portFree = (port) => new Promise((r) => {
  const s = createServer();
  s.once('error', () => r(false));
  s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
});

const docker = (args, env = {}) => execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
const projectPorts = (name) => docker(['ps', '--filter', `label=com.supabase.cli.project=${name}`, '--format', '{{.Ports}}']).split('\n').filter(Boolean);

function spawnDetached(cmd, args, { cwd, env, log }) {
  const fd = openSync(log, 'a', 0o600);
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return child.pid;
}

const httpsStatus = (url, ca) => new Promise((r) => {
  const req = request(url, { ca, timeout: 10_000 }, (res) => { res.resume(); r(res.statusCode ?? 0); });
  req.on('error', () => r(0));
  req.on('timeout', () => { req.destroy(); r(0); });
  req.end();
});

function makeTls(dir) {
  mkdirSync(dir, { mode: 0o700 });
  const ssl = (args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=cadence acceptance local CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', 'ca-key.pem', '-out', 'ca.pem']);
  ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-keyout', 'key.pem', '-out', 'leaf.csr']);
  writeFileSync(join(dir, 'leaf.cnf'), 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  ssl(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-days', '2', '-extfile', 'leaf.cnf', '-out', 'cert.pem']);
  chmodSync(join(dir, 'key.pem'), 0o600);
  chmodSync(join(dir, 'ca-key.pem'), 0o600);
  rmSync(join(dir, 'leaf.csr'));
}

async function up({ name, dbBase, appPort, repo }) {
  if (existsSync(stateFile(name))) fail(`${name} is already up (${stateFile(name)}); run down first`);
  if (!existsSync(join(repo, 'supabase', 'config.toml')) || !existsSync(join(repo, 'node_modules', 'next'))) fail('run from a worktree root that has supabase/ and node_modules (npm ci)');
  for (const env of ['.env.local', '.env.development.local']) if (existsSync(join(repo, env))) fail(`${env} exists in this checkout; use a clean worktree so no real secret loads into the app`);
  if (/\/mcp-create\/cadence\/?$/.test(repo)) fail("this is Ticket 232's live checkout; use your own worktree");
  const ports = portsFor(dbBase);
  for (const port of [...new Set(Object.values(ports)), appPort]) if (!(await portFree(port))) fail(`port ${port} is in use`);

  const work = mkdtempSync(`/tmp/${name}.`);
  chmodSync(work, 0o700);
  writeFileSync(stateFile(name), `${work}\n`, { mode: 0o600 });
  writeFileSync(join(work, 'state.json'), JSON.stringify({ name, dbBase, appPort, repo, ports }), { mode: 0o600 });
  mkdirSync(join(work, 'supabase'));
  mkdirSync(join(work, 'snapshot'));
  for (const file of REWRITTEN) if (existsSync(join(repo, file))) copyFileSync(join(repo, file), join(work, 'snapshot', file));
  copyFileSync(join(repo, 'supabase', 'seed.sql'), join(work, 'supabase', 'seed.sql'));
  symlinkSync(join(repo, 'supabase', 'migrations'), join(work, 'supabase', 'migrations'));
  writeFileSync(join(work, 'supabase', 'config.toml'), rewriteConfig(readFileSync(join(repo, 'supabase', 'config.toml'), 'utf8'), { name, ports }));
  writeFileSync(join(work, 'supabase', 'signing_keys.json'), '[]', { mode: 0o600 });
  execFileSync(SUPABASE, ['gen', 'signing-key', '--algorithm', 'ES256', '--append', '--workdir', work], { stdio: 'ignore' });
  say(`workdir ${work}`);

  writeFileSync(join(work, 'docker-proxy.mjs'), proxySource(name));
  const sock = join(work, 'docker.sock');
  const proxyPid = spawnDetached(process.execPath, [join(work, 'docker-proxy.mjs'), sock, DOCKER_SOCK], { cwd: work, env: process.env, log: join(work, 'proxy.log') });
  writeFileSync(join(work, 'proxy.pid'), String(proxyPid));
  for (let i = 0; i < 50 && !readFileSync(join(work, 'proxy.log'), 'utf8').includes('proxy-ready'); i += 1) await sleep(100);
  if (!existsSync(sock)) fail('docker proxy did not start; see proxy.log in the workdir');

  say(`starting supabase ${name} (API ${ports.api}, DB ${ports.db}); this can take a few minutes`);
  const log = join(work, 'start.log');
  try {
    execFileSync(SUPABASE, ['start', '--workdir', work, '-x', EXCLUDE], {
      cwd: '/tmp', env: { ...process.env, DOCKER_HOST: `unix://${sock}`, SUPABASE_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', openSync(log, 'w', 0o600), openSync(log, 'a', 0o600)], timeout: 15 * 60_000,
    });
  } catch {
    const safe = readFileSync(log, 'utf8').split('\n').filter((l) => l && !/key|secret|jwt|token|password/i.test(l)).slice(-8);
    rmSync(log, { force: true });
    fail(`supabase start failed:\n${safe.join('\n')}\nRun down, then up again.`);
  }
  rmSync(log, { force: true });
  const bound = projectPorts(name);
  if (!bound.length || !loopbackOnly(bound)) {
    await down({ name, quiet: true });
    fail(`a port was not bound to 127.0.0.1 (${bound.join(' | ')}); stack stopped`);
  }
  say(`supabase up, loopback only: ${bound.length} containers`);

  makeTls(join(work, 'tls'));
  const status = JSON.parse(execFileSync(SUPABASE, ['status', '--workdir', work, '-o', 'json'], { cwd: '/tmp', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const issuer = `https://127.0.0.1:${appPort}`;
  const appEnv = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, CADENCE_MCP_ENABLED: 'true', CADENCE_OAUTH_ISSUER: issuer,
    CADENCE_ENABLE_TEST_LOGIN: '1', CADENCE_INTEGRATION_JWT_SIGNING_KEY: readFileSync(join(work, 'supabase', 'signing_keys.json'), 'utf8').trim(),
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const runner = {
    CADENCE_LOCAL_SUPABASE_URL: status.API_URL, CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY: appEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    CADENCE_ACCEPT_ISSUER: issuer, CADENCE_ACCEPT_CA_FILE: join(work, 'tls', 'ca.pem'), CADENCE_ACCEPT_DB_URL: status.DB_URL,
    CADENCE_ACCEPT_WORKDIR: work,
  };
  writeFileSync(join(work, 'runner.env'), `${Object.entries(runner).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n')}\n`, { mode: 0o600 });

  const appPid = spawnDetached(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(appPort),
    '--experimental-https', '--experimental-https-key', join(work, 'tls', 'key.pem'), '--experimental-https-cert', join(work, 'tls', 'cert.pem')],
  { cwd: repo, env: { ...process.env, ...appEnv }, log: join(work, 'app.log') });
  writeFileSync(join(work, 'app.pid'), String(appPid));
  const ca = readFileSync(join(work, 'tls', 'ca.pem'));
  let code = 0;
  for (let i = 0; i < 60 && code !== 200; i += 1) { await sleep(3_000); code = await httpsStatus(`${issuer}/.well-known/oauth-authorization-server`, ca); }
  if (code !== 200) fail(`app did not answer discovery on ${issuer} (last status ${code}); see app.log in the workdir`);
  say(`app ${issuer} (MCP on, test login on)`);
  say(`load the runner env: set -a; . ${join(work, 'runner.env')}; set +a`);
}

const killGroup = (pidFile) => {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
};

async function down({ name, quiet = false }) {
  if (!existsSync(stateFile(name))) { if (!quiet) say(`${name} is not up`); return; }
  const work = readFileSync(stateFile(name), 'utf8').trim();
  if (!work.startsWith(`/tmp/${name}.`)) fail(`unexpected workdir in ${stateFile(name)}`);
  const state = JSON.parse(readFileSync(join(work, 'state.json'), 'utf8'));
  killGroup(join(work, 'app.pid'));
  await sleep(2_000);
  try { execFileSync(SUPABASE, ['stop', '--no-backup', '--workdir', work], { cwd: '/tmp', stdio: 'ignore', timeout: 5 * 60_000 }); } catch { /* checked below */ }
  const label = `label=com.supabase.cli.project=${name}`;
  for (const c of docker(['ps', '-a', '--filter', label, '--format', '{{.Names}}']).split('\n').filter(Boolean)) docker(['rm', '-f', c]);
  for (const v of docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']).split('\n').filter(Boolean)) docker(['volume', 'rm', '-f', v]);
  for (const n of docker(['network', 'ls', '--format', '{{.Name}}']).split('\n').filter((x) => x.endsWith(`_${name}`))) { try { docker(['network', 'rm', n]); } catch { /* in use */ } }
  killGroup(join(work, 'proxy.pid'));
  for (const file of REWRITTEN) {
    const saved = join(work, 'snapshot', file);
    if (existsSync(saved) && readFileSync(saved, 'utf8') !== readFileSync(join(state.repo, file), 'utf8')) { copyFileSync(saved, join(state.repo, file)); say(`restored ${file} (next dev rewrote it)`); }
  }
  rmSync(work, { recursive: true, force: true });
  rmSync(stateFile(name), { force: true });
  const left = docker(['ps', '-a', '--filter', label, '--format', '{{.Names}}']).trim();
  const busy = [];
  for (const port of [...Object.values(state.ports), state.appPort]) if (!(await portFree(port))) busy.push(port);
  say(`${name} down: containers ${left ? left.replace(/\n/g, ',') : 'none'}, ports still busy ${busy.length ? busy.join(',') : 'none'}, workdir deleted`);
}

async function status({ name }) {
  if (!existsSync(stateFile(name))) { say(`${name} is not up`); return; }
  const work = readFileSync(stateFile(name), 'utf8').trim();
  const state = JSON.parse(readFileSync(join(work, 'state.json'), 'utf8'));
  const bound = projectPorts(name);
  const ca = existsSync(join(work, 'tls', 'ca.pem')) ? readFileSync(join(work, 'tls', 'ca.pem')) : undefined;
  const code = ca ? await httpsStatus(`https://127.0.0.1:${state.appPort}/.well-known/oauth-authorization-server`, ca) : 0;
  say(`${name}: workdir ${work}; containers running ${bound.length} (loopback only: ${loopbackOnly(bound)}); app https://127.0.0.1:${state.appPort} discovery ${code || 'down'}`);
  if (!bound.length) say('containers are gone (Docker restart?): run down, then up again');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    name: { type: 'string', default: 'cadence-accept-run' }, 'db-base': { type: 'string', default: '56150' }, 'app-port': { type: 'string', default: '4450' },
  } });
  const [command] = positionals;
  const name = values.name;
  if (!NAME.test(name)) fail('--name must look like cadence-accept-<letters, digits, ->');
  const dbBase = Number(values['db-base']);
  const appPort = Number(values['app-port']);
  if (!Number.isInteger(dbBase) || dbBase < 56000 || dbBase > 56990 || dbBase % 10 !== 0) fail('--db-base must be a multiple of 10 in 56000–56990 (57xxx is avoided, 553xx is Emi’s stack)');
  if (!Number.isInteger(appPort) || appPort < 4400 || appPort > 4499) fail('--app-port must be in 4400–4499 (4321–4330 belong to live runs)');
  if (command === 'up') await up({ name, dbBase, appPort, repo: process.cwd() });
  else if (command === 'down') await down({ name });
  else if (command === 'status') await status({ name });
  else fail('usage: local-stack.mjs up|status|down [--name cadence-accept-…] [--db-base 56150] [--app-port 4450]');
}
