import http from "node:http";
import { chmod, lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const PROJECT = "habit-tracking-app";
export const NETWORK = "cadence-local";
const DB = `supabase_db_${PROJECT}`;
const LABELS = ["com.supabase.cli.project", "com.docker.compose.project"];
// Pinned to the installed supabase-go 2.105.0 Dockerfile, not mutable latest tags.
const IMAGES = {
  db: "postgres:17.6.1.132", kong: "kong:2.8.1", auth: "gotrue:v2.189.0",
  inbucket: "mailpit:v1.22.3", realtime: "realtime:v2.103.2",
  rest: "postgrest:v14.12", storage: "storage-api:v1.60.4",
};
const imageFor = (service) => `public.ecr.aws/supabase/${IMAGES[service]}`;
const NAMES = new Map(Object.keys(IMAGES).map((service) => [`supabase_${service}_${PROJECT}`, imageFor(service)]));
const VOLUMES = new Map([[DB, "/var/lib/postgresql/data"], [`supabase_storage_${PROJECT}`, "/mnt"]]);
const JOBS = new Map([
  [imageFor("auth"), ["gotrue", "migrate"]],
  [imageFor("storage"), ["node", "dist/scripts/migrate-call.js"]],
  [imageFor("realtime"), ["/app/bin/realtime", "eval", '{:ok, _} = Application.ensure_all_started(:realtime)\n{:ok, _} = Realtime.Tenants.health_check("realtime-dev")']],
]);
const CONFIG_KEYS = new Set("Hostname Domainname User AttachStdin AttachStdout AttachStderr ExposedPorts Tty OpenStdin StdinOnce Env Cmd Healthcheck ArgsEscaped Image Volumes WorkingDir Entrypoint NetworkDisabled MacAddress OnBuild Labels StopSignal StopTimeout Shell HostConfig NetworkingConfig".split(" "));
const HOST_KEYS = new Set("Binds NetworkMode PortBindings RestartPolicy ExtraHosts".split(" "));
const MAX_BODY = 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const inert = (value) => value == null || value === false || value === "" || value === 0 ||
  (typeof value === "object" && Object.values(value).every(inert));
const requireSafe = (condition) => { if (!condition) throw new Error("Cadence Docker request rejected."); };
const owned = (labels) => object(labels) && LABELS.every((label) => labels[label] === PROJECT);

/** Validate before changing any binding. Never accept other projects or host mounts. */
export function rewriteCreate(name, value) {
  requireSafe(object(value));
  const body = structuredClone(value);
  requireSafe(Object.keys(body).every((key) => CONFIG_KEYS.has(key)) && owned(body.Labels));
  requireSafe(["Env", "Cmd", "Entrypoint"].every((key) => body[key] == null ||
    (Array.isArray(body[key]) && body[key].every((entry) => typeof entry === "string"))));
  const host = body.HostConfig;
  requireSafe(object(host) && host.NetworkMode === NETWORK);
  requireSafe(Object.entries(host).every(([key, entry]) => HOST_KEYS.has(key) || inert(entry)));
  requireSafe(host.ExtraHosts == null || (Array.isArray(host.ExtraHosts) &&
    host.ExtraHosts.every((entry) => entry === "host.docker.internal:host-gateway")));
  const endpoints = body.NetworkingConfig?.EndpointsConfig;
  requireSafe(body.NetworkingConfig == null ||
    (object(body.NetworkingConfig) && Object.keys(body.NetworkingConfig).every((key) => key === "EndpointsConfig") &&
      (endpoints == null || (object(endpoints) && Object.keys(endpoints).every((key) => key === NETWORK)))));
  requireSafe(host.Binds == null || (Array.isArray(host.Binds) && host.Binds.every((bind) => {
    if (typeof bind !== "string") return false;
    const [source, target, mode, ...extra] = bind.split(":");
    return VOLUMES.get(source) === target && (!mode || mode === "rw" || mode === "ro") && extra.length === 0;
  })));
  const ports = host.PortBindings ?? {};
  requireSafe(object(ports));
  for (const [port, bindings] of Object.entries(ports)) {
    requireSafe(/^\d+\/(tcp|udp)$/.test(port) && Array.isArray(bindings) && bindings.length > 0);
    for (const binding of bindings) {
      requireSafe(object(binding) && Object.keys(binding).every((key) => ["HostIp", "HostPort"].includes(key)) &&
        typeof binding.HostPort === "string" && /^\d+$/.test(binding.HostPort) &&
        Number(binding.HostPort) > 0 && Number(binding.HostPort) <= 65535);
      binding.HostIp = "127.0.0.1";
    }
  }
  if (name) requireSafe(NAMES.get(name) === body.Image);
  else {
    requireSafe(JOBS.has(body.Image) && JSON.stringify(body.Cmd) === JSON.stringify(JOBS.get(body.Image)) &&
      inert(body.Entrypoint) && inert(body.ExposedPorts) && inert(body.Volumes) &&
      inert(host.Binds) && inert(ports) && inert(host.RestartPolicy));
    requireSafe(Array.isArray(body.Env) && body.Env.every((entry) => typeof entry === "string" && entry.includes("=")));
    const env = new Map();
    for (const entry of body.Env) {
      const index = entry.indexOf("=");
      const key = entry.slice(0, index);
      requireSafe(!env.has(key));
      env.set(key, entry.slice(index + 1));
    }
    if (body.Image === imageFor("realtime")) requireSafe(env.get("DB_HOST") === DB && env.get("DB_PORT") === "5432" && env.get("DB_NAME") === "postgres");
    else {
      let url;
      try { url = new URL(env.get(body.Image === imageFor("auth") ? "GOTRUE_DB_DATABASE_URL" : "DATABASE_URL")); }
      catch { requireSafe(false); }
      requireSafe(url.protocol === "postgresql:" && url.hostname === DB && url.port === "5432" &&
        url.pathname === "/postgres" && !url.search && !url.hash);
    }
  }
  return body;
}

async function readBody(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    requireSafe(bytes <= MAX_BODY);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseBody(bytes) {
  try { const result = JSON.parse(bytes.toString()); requireSafe(object(result)); return result; }
  catch { throw new Error("Cadence Docker request rejected."); }
}

function reply(response, status, message) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ message }));
}

/** This supports start/reset/status only. No exec, attach, prune, or global settings. */
export function createDockerProxy(daemonSocket) {
  requireSafe(typeof daemonSocket === "string" && daemonSocket.startsWith("/"));
  const inspect = async (path) => {
    const response = await new Promise((ok, fail) => {
      const request = http.request({ socketPath: daemonSocket, path, method: "GET" }, ok);
      request.setTimeout(15_000, () => request.destroy());
      request.on("error", fail);
      request.end();
    });
    const bytes = await readBody(response);
    if (response.statusCode === 404) return null;
    requireSafe(response.statusCode === 200);
    return parseBody(bytes);
  };
  const server = http.createServer(async (request, response) => {
    try {
      requireSafe(request.url?.startsWith("/") && !request.url.startsWith("//"));
      const url = new URL(request.url, "http://docker.local");
      const path = url.pathname.replace(/^\/v\d+\.\d+(?=\/)/, "");
      const method = request.method;
      const read = method === "GET" || method === "HEAD";
      const bytes = await readBody(request);
      let forwarded = bytes;
      if (read) {
        requireSafe(/^\/(?:_ping|version|info|containers\/json|containers\/[^/]+\/(?:json|logs)|images\/.+\/json|networks(?:\/[^/]+)?|volumes(?:\/[^/]+)?)$/.test(path));
      } else if (method === "POST" && path === "/containers/create") {
        requireSafe([...url.searchParams.keys()].every((key) => key === "name") && url.searchParams.getAll("name").length <= 1);
        forwarded = Buffer.from(JSON.stringify(rewriteCreate(url.searchParams.get("name") ?? "", parseBody(bytes))));
      } else if (method === "POST" && path === "/networks/create") {
        const body = parseBody(bytes);
        requireSafe(body.Name === NETWORK && owned(body.Labels));
        const network = await inspect(`/networks/${NETWORK}`);
        requireSafe(network?.Name === NETWORK && network.Driver === "bridge" &&
          network.Options?.["com.docker.network.bridge.host_binding_ipv4"] === "127.0.0.1");
        // The network must already exist. Avoid changing any Docker network here.
        reply(response, 409, "Cadence network already exists.");
        return;
      } else if (method === "POST" && path === "/volumes/create") {
        const body = parseBody(bytes);
        requireSafe(VOLUMES.has(body.Name) && owned(body.Labels) &&
          Object.entries(body).every(([key, entry]) => ["Name", "Labels"].includes(key) || inert(entry)));
        const existing = await inspect(`/volumes/${encodeURIComponent(body.Name)}`);
        requireSafe(existing === null || owned(existing.Labels));
      } else if (method === "DELETE" && /^\/volumes\/[^/]+$/.test(path)) {
        const name = decodeURIComponent(path.split("/")[2]);
        requireSafe(VOLUMES.has(name));
        const existing = await inspect(`/volumes/${encodeURIComponent(name)}`);
        if (!existing) { reply(response, 404, "Cadence volume not found."); return; }
        requireSafe(owned(existing.Labels));
      } else if (method === "POST" && path === "/images/create") {
        requireSafe(inert(bytes.length) && [...url.searchParams.keys()].every((key) => ["fromImage", "tag"].includes(key)));
        const image = url.searchParams.get("fromImage");
        const tag = url.searchParams.get("tag");
        requireSafe([...NAMES.values()].includes(tag ? `${image}:${tag}` : image));
      } else {
        const container = path.match(/^\/containers\/([^/]+)(?:\/(start|stop|restart|kill|wait))?$/);
        requireSafe(container && ((method === "POST" && container[2]) || (method === "DELETE" && !container[2])));
        const current = await inspect(`/containers/${encodeURIComponent(decodeURIComponent(container[1]))}/json`);
        if (!current) { reply(response, 404, "Cadence container not found."); return; }
        requireSafe(owned(current.Config?.Labels) && current.HostConfig?.NetworkMode === NETWORK &&
          [...NAMES.values()].includes(current.Config?.Image));
        if (["start", "restart"].includes(container[2])) {
          requireSafe(!current.HostConfig.PublishAllPorts && Object.values(current.HostConfig.PortBindings ?? {})
            .every((bindings) => Array.isArray(bindings) && bindings.every((binding) => binding.HostIp === "127.0.0.1")));
        }
      }
      const headers = { ...request.headers, "content-length": String(forwarded.length) };
      delete headers["transfer-encoding"];
      delete headers.connection;
      const upstream = http.request({ socketPath: daemonSocket, path: request.url, method, headers }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      upstream.setTimeout(120_000, () => upstream.destroy());
      upstream.on("error", () => {
        if (response.headersSent) response.destroy();
        else reply(response, 502, "Local Docker request failed.");
      });
      response.on("close", () => upstream.destroy());
      upstream.end(forwarded);
    } catch {
      if (!response.headersSent) reply(response, 403, "Cadence Docker request rejected.");
      else response.destroy();
    }
  });
  server.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [socket, daemonSocket] = process.argv.slice(2);
  try {
    requireSafe(process.argv.length === 4 && socket?.startsWith("/") && daemonSocket?.startsWith("/") && socket !== daemonSocket);
    requireSafe((await lstat(daemonSocket)).isSocket());
    const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
    requireSafe(/^project_id\s*=\s*"habit-tracking-app"\s*$/m.test(config));
    // listen fails on an existing socket; never unlink another process's socket.
    process.umask(0o077);
    const server = createDockerProxy(daemonSocket);
    server.on("error", () => { console.error("Cadence Docker proxy could not listen."); process.exitCode = 1; });
    server.listen(socket, async () => {
      await chmod(socket, 0o600);
      console.info("Cadence Docker proxy ready.");
    });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
  } catch {
    console.error("Cadence Docker proxy requires a new Unix socket, the Docker Unix socket, and the Cadence project config.");
    process.exitCode = 1;
  }
}
