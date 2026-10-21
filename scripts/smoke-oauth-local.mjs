// Ticket 226. Synthetic accounts only; requires its assigned disposable stack.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";

const workdir = process.env.CADENCE_OAUTH_TEST_WORKDIR;
assert(workdir, "Set CADENCE_OAUTH_TEST_WORKDIR to the disposable cadence-mcp-226 workdir.");
const cli = process.env.CADENCE_SUPABASE_CLI ?? "supabase";
const status = JSON.parse(execFileSync(cli, ["status", "--workdir", workdir, "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
assert.equal(status.API_URL, "http://127.0.0.1:56721", "Only Ticket 226's isolated stack is allowed.");
const ports = execFileSync("docker", ["ps", "--filter", "name=cadence-mcp-226", "--format", "{{.Ports}}"], { encoding: "utf8" });
assert(!/0\.0\.0\.0:|\[::\]:|:::/.test(ports), "Database ports must bind to loopback.");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const user = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = (text) => execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
  input: text, encoding: "utf8", env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: "56722", PGUSER: "postgres", PGPASSWORD: "postgres", PGDATABASE: "postgres" }, stdio: ["pipe", "pipe", "pipe"],
});
const rpc = async (client, name, args) => { const result = await client.rpc(name, args); assert(!result.error, `${name} failed`); return result.data; };
// This script exclusively owns the disposable 226 stack, including its admission buckets.
sql("delete from cadence_oauth_private.rate_limit_counters where action in ('oauth_request','oauth_global','client_registration');");
let port;
for (let candidate = 4321; candidate <= 4330; candidate++) {
  const free = await new Promise((resolve) => { const server = createServer(); server.once("error", () => resolve(false)); server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true))); });
  if (free) { port = candidate; break; }
}
assert(port, "No free port in 4321–4330.");
const origin = `http://127.0.0.1:${port}`;
const dev = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, CADENCE_MCP_ENABLED: "true", CADENCE_OAUTH_ISSUER: origin,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY }, stdio: "ignore",
});
const clients = [];
let userId;
try {
  for (let i = 0; i < 100; i++) {
    assert(dev.exitCode === null, "next dev exited before readiness");
    try { if ((await fetch(`${origin}/.well-known/oauth-authorization-server`)).status === 200) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json();
  assert.equal(metadata.issuer, origin); assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = await fetch(origin + path); const body = await response.json();
    assert.equal(body.resource, `${origin}/mcp`); assert.deepEqual(body.authorization_servers, [origin]);
    assert(!body.scopes_supported.includes("offline_access")); assert.equal(response.headers.get("cache-control"), "no-store");
    const curlCode = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", origin + path], { encoding: "utf8" });
    assert.equal(curlCode, "200");
  }
  console.log(`OAuth discovery verified at ${origin}.`);
  const email = `oauth-${opaque().slice(0, 12)}@example.test`; const password = opaque();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert(!created.error && created.data.user, "Synthetic account creation failed"); userId = created.data.user.id;
  assert(!(await user.auth.signInWithPassword({ email, password })).error, "Synthetic sign-in failed");
  const registration = await fetch(`${origin}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "OAuth smoke", application_type: "native", redirect_uris: ["http://localhost/callback"], token_endpoint_auth_method: "none" }) });
  assert.equal(registration.status, 201); const registered = await registration.json(); const clientId = registered.client_id; clients.push(clientId);
  const begin = async () => {
    const verifier = opaque(); const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "http://localhost:49152/callback", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}/mcp`, scope: "cadence.read cadence.behaviors.write offline_access", state: "synthetic-state" });
    const response = await fetch(`${origin}/oauth/authorize?${params}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")); const id = location.searchParams.get("request");
    assert.equal(location.pathname, "/oauth/consent");
    const browserSecret = response.headers.get("set-cookie").split(";")[0].split("=")[1];
    const browserHash = hash(browserSecret);
    const pending = await rpc(user, "oauth_read_pending", { p_id: id, p_browser_hash: browserHash });
    assert.equal(pending.client_name, "OAuth smoke"); assert.equal(pending.verified_client, null);
    assert.equal(await rpc(user, "oauth_read_pending", { p_id: id, p_browser_hash: hash("wrong-browser") }), null);
    assert((await anon.rpc("oauth_read_pending", { p_id: id, p_browser_hash: browserHash })).error);
    assert((await admin.rpc("oauth_read_pending", { p_id: id, p_browser_hash: browserHash })).error, "Service role cannot read user consent");
    return { id, verifier, browserHash };
  };
  // Ticket 227 owns the UI. Its authenticated consent RPC completes the same pending request here.
  const approve = async () => {
    const pending = await begin(); const code = opaque();
    const input = { p_id: pending.id, p_browser_hash: pending.browserHash, p_scopes: ["cadence.read"], p_code_hash: hash(code) };
    assert((await user.rpc("oauth_finish_pending", { ...input, p_scopes: ["cadence.read", "cadence.occurrences.write"] })).error, "Consent cannot widen requested scopes");
    const approval = await rpc(user, "oauth_finish_pending", input); assert.equal(approval.approved, true);
    assert.equal(await rpc(user, "oauth_finish_pending", input), null, "Consent must be single use");
    return { ...pending, code };
  };
  const form = async (path, body) => {
    const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    return { status: response.status, body: path.endsWith("revoke") ? null : await response.json() };
  };
  const exchange = (grant, overrides = {}) => form("/oauth/token", { grant_type: "authorization_code", client_id: clientId, code: grant.code, code_verifier: grant.verifier, redirect_uri: "http://localhost:49152/callback", resource: `${origin}/mcp`, ...overrides });
  const refresh = (value, overrides = {}) => form("/oauth/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: value, resource: `${origin}/mcp`, ...overrides });
  const verify = (value) => rpc(admin, "oauth_verify_access_token", { p_access_token_hash: hash(value), p_resource: `${origin}/mcp` });
  const denial = await begin();
  assert.equal((await rpc(user, "oauth_finish_pending", { p_id: denial.id, p_browser_hash: denial.browserHash, p_scopes: null, p_code_hash: null })).approved, false);
  for (const invalid of [{ code_verifier: opaque() }, { redirect_uri: "http://localhost:49153/other" }, { resource: `${origin}/other` }, { client_id: "other" }]) {
    const result = await exchange(await approve(), invalid); assert.equal(result.status, 400); assert.equal(result.body.error, "invalid_grant");
  }
  const expired = await approve();
  sql(`update cadence_oauth_private.authorization_codes set created_at=now()-interval '20 minutes', expires_at=now()-interval '11 minutes' where code_hash='${hash(expired.code)}';`);
  assert.equal((await exchange(expired)).body.error, "invalid_grant");
  const reused = await approve(); const issued = await exchange(reused); assert.equal(issued.status, 200);
  assert.equal(issued.body.scope, "cadence.read offline_access"); assert.equal((await verify(issued.body.access_token)).active, true);
  assert.equal((await exchange(reused)).body.error, "invalid_grant"); assert.equal((await verify(issued.body.access_token)).active, false);
  const normal = (await exchange(await approve())).body;
  assert.equal((await refresh(normal.refresh_token, { resource: `${origin}/wrong` })).body.error, "invalid_grant");
  assert.equal((await refresh(normal.refresh_token, { scope: "cadence.read cadence.behaviors.write" })).body.error, "invalid_scope");
  const rotated = await refresh(normal.refresh_token); assert.equal(rotated.status, 200); assert(rotated.body.refresh_token !== normal.refresh_token, "Refresh token must rotate");
  assert.equal((await refresh(normal.refresh_token)).body.error, "invalid_grant"); assert.equal((await verify(rotated.body.access_token)).active, false);
  assert.equal((await refresh(opaque())).body.error, "invalid_grant");
  const idleExpired = (await exchange(await approve())).body;
  sql(`update cadence_oauth_private.tokens set created_at=now()-interval '31 days', expires_at=now()-interval '1 day' where token_hash='${hash(idleExpired.refresh_token)}';`);
  assert.equal((await refresh(idleExpired.refresh_token)).body.error, "invalid_grant");
  const revoked = (await exchange(await approve())).body;
  assert.equal((await form("/oauth/revoke", { client_id: clientId, token: revoked.refresh_token })).status, 200);
  assert.equal((await verify(revoked.access_token)).active, false);
  assert.equal((await refresh(revoked.refresh_token)).body.error, "invalid_grant");
  const grantRevoked = (await exchange(await approve())).body; const active = await verify(grantRevoked.access_token);
  await rpc(user, "oauth_revoke_grant", { p_grant_id: active.grant_id });
  assert.equal((await verify(grantRevoked.access_token)).active, false);
  const expiring = (await exchange(await approve())).body;
  sql(`update cadence_oauth_private.tokens set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where token_hash='${hash(expiring.access_token)}';`);
  assert.equal((await verify(expiring.access_token)).active, false);
  const pendingExpired = await begin();
  sql(`update cadence_oauth_private.pending_authorizations set expires_at=now()-interval '1 second' where id='${pendingExpired.id}';`);
  assert.equal(await rpc(user, "oauth_finish_pending", { p_id: pendingExpired.id, p_browser_hash: pendingExpired.browserHash, p_scopes: ["cadence.read"], p_code_hash: hash(opaque()) }), null);
  sql("delete from cadence_oauth_private.rate_limit_counters where action in ('oauth_request','client_registration');");
  for (let i = 0; i < 11; i++) {
    const result = await fetch(`${origin}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://example.test/callback"] }) });
    assert.equal(result.status, i < 10 ? 201 : 429);
    if (i < 10) clients.push((await result.json()).client_id);
  }
  const unused = clients.at(-1);
  sql(`update cadence_oauth_private.clients set registration_expires_at=now()-interval '1 second' where client_id='${unused}';`);
  assert.equal(await rpc(admin, "oauth_get_client", { p_client_id: unused }), null);
  console.log("OAuth code flow, denial, single use, expiry, PKCE/client/redirect/resource binding, refresh reuse, revoke, grant revocation and registration limits passed.");
} finally {
  dev.kill("SIGTERM");
  if (userId) {
    assert(!(await admin.auth.admin.deleteUser(userId)).error, "Synthetic account cleanup failed");
    assert.equal(sql(`select count(*) from auth.users where id='${userId}';`).trim(), "0");
  }
  for (const id of clients) {
    assert(/^[0-9a-f-]{36}$/.test(id)); sql(`delete from cadence_oauth_private.clients where client_id='${id}';`);
  }
  sql("delete from cadence_oauth_private.rate_limit_counters where action in ('oauth_request','oauth_global','client_registration');");
  console.log("Synthetic OAuth account and registrations cleaned up; next dev stopped.");
}
