import http, { type IncomingHttpHeaders } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const modulePath = "../scripts/supabase-docker-proxy.mjs";
const { createDockerProxy, rewriteCreate } = await import(modulePath);
const PROJECT = "habit-tracking-app";
const DB = `supabase_db_${PROJECT}`;
const labels = { "com.supabase.cli.project": PROJECT, "com.docker.compose.project": PROJECT };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function createBody() {
  return {
    Image: "public.ecr.aws/supabase/postgres:17.6.1.132", Labels: { ...labels },
    Env: ["PRIVATE_VALUE=must-not-appear-in-errors"],
    HostConfig: {
      NetworkMode: "cadence-local", Binds: [`${DB}:/var/lib/postgresql/data`],
      PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55322" }, { HostIp: "::", HostPort: "55322" }] },
      Privileged: false, Mounts: null, ConsoleSize: [0, 0],
    },
    NetworkingConfig: { EndpointsConfig: { "cadence-local": { Aliases: ["db"] } } },
  };
}

function job(image: string, command: string[], env: string[]) {
  return { Image: image, Cmd: command, Env: env, Labels: { ...labels }, HostConfig: { NetworkMode: "cadence-local" } };
}
const jobs = [
  job("public.ecr.aws/supabase/gotrue:v2.189.0", ["gotrue", "migrate"], [`GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin:private@${DB}:5432/postgres`]),
  job("public.ecr.aws/supabase/storage-api:v1.60.4", ["node", "dist/scripts/migrate-call.js"], [`DATABASE_URL=postgresql://supabase_storage_admin:private@${DB}:5432/postgres`]),
  job("public.ecr.aws/supabase/realtime:v2.103.2", ["/app/bin/realtime", "eval", '{:ok, _} = Application.ensure_all_started(:realtime)\n{:ok, _} = Realtime.Tenants.health_check("realtime-dev")'], [`DB_HOST=${DB}`, "DB_PORT=5432", "DB_NAME=postgres"]),
];

describe("Cadence Docker create policy", () => {
  it("forces every explicit binding onto loopback without changing the input or its private environment", () => {
    const body = createBody();
    const rewritten = rewriteCreate(DB, body);
    expect(rewritten.HostConfig.PortBindings["5432/tcp"].map((binding: { HostIp: string }) => binding.HostIp)).toEqual(["127.0.0.1", "127.0.0.1"]);
    expect(rewritten.Env).toEqual(body.Env);
    expect(body.HostConfig.PortBindings["5432/tcp"][0].HostIp).toBe("0.0.0.0");
  });

  it.each([
    ["other project", (body: Record<string, unknown>) => { body.Labels = { ...labels, "com.supabase.cli.project": "other" }; }],
    ["missing second label", (body: Record<string, unknown>) => { body.Labels = { "com.supabase.cli.project": PROJECT }; }],
    ["unpinned image", (body: Record<string, unknown>) => { body.Image = "public.ecr.aws/supabase/postgres:latest"; }],
    ["unrecognized create field", (body: Record<string, unknown>) => { body.FuturePrivilege = true; }],
    ["host network", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).NetworkMode = "host"; }],
    ["additional network", (body: Record<string, unknown>) => { body.NetworkingConfig = { EndpointsConfig: { "cadence-local": {}, other: {} } }; }],
    ["host mount", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).Binds = ["/var/run/docker.sock:/var/run/docker.sock"]; }],
    ["mount object", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).Mounts = [{ Type: "bind", Source: "/", Target: "/host" }]; }],
    ["privileged mode", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).Privileged = true; }],
    ["implicit published ports", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).PublishAllPorts = true; }],
    ["malformed binding", (body: Record<string, unknown>) => { (body.HostConfig as Record<string, unknown>).PortBindings = { "5432/tcp": [{ HostPort: "" }] }; }],
  ])("rejects %s before Docker receives a create", (_description, change) => {
    const body = createBody();
    change(body);
    expect(() => rewriteCreate(DB, body)).toThrow("Cadence Docker request rejected.");
  });

  it("requires a listed service name", () => {
    expect(() => rewriteCreate(`supabase_arbitrary_${PROJECT}`, createBody())).toThrow();
    expect(() => rewriteCreate("", createBody())).toThrow();
    expect(() => rewriteCreate(DB, null)).toThrow();
  });

  it.each(jobs)("accepts the exact initialization command for $Image", (body) => {
    expect(rewriteCreate("", body).Cmd).toEqual(body.Cmd);
    expect(() => rewriteCreate("", { ...body, Cmd: ["sh", "-c", "arbitrary command"] })).toThrow();
    expect(() => rewriteCreate("", { ...body, Entrypoint: ["sh"] })).toThrow();
    expect(() => rewriteCreate("", { ...body, HostConfig: { ...body.HostConfig, PortBindings: { "9999/tcp": [{ HostPort: "55325" }] } } })).toThrow();
    expect(() => rewriteCreate("", { ...body, Env: body.Env.map((value) => value.replace(DB, "another-db")) })).toThrow();
    expect(() => rewriteCreate("", { ...body, Env: [...body.Env, body.Env[0]] })).toThrow();
  });
});

interface RecordedRequest { path: string; method: string; headers: IncomingHttpHeaders; body: Buffer }
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "cadence-docker-proxy-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const daemonSocket = join(directory, "daemon.sock");
  const proxySocket = join(directory, "proxy.sock");
  const received: RecordedRequest[] = [];
  const current = { Config: { Image: createBody().Image, Labels: labels }, HostConfig: {
    NetworkMode: "cadence-local", PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55322" }] },
  } };
  const daemon = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const path = request.url!;
    received.push({ path, method: request.method!, headers: request.headers, body: Buffer.concat(chunks) });
    if (path === "/containers/owned/json") response.end(JSON.stringify(current));
    else if (path === "/containers/foreign/json") response.end(JSON.stringify({ ...current, Config: { ...current.Config, Labels: { ...labels, "com.docker.compose.project": "other" } } }));
    else if (path === "/containers/unsafe/json") response.end(JSON.stringify({ ...current, HostConfig: { ...current.HostConfig, PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55322" }] } } }));
    else if (request.method === "GET" && path.startsWith("/volumes/")) response.end(JSON.stringify({ Labels: labels }));
    else if (path === "/networks/cadence-local") response.end(JSON.stringify({ Name: "cadence-local", Driver: "bridge", Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } }));
    else if (path.endsWith("/logs?follow=1")) {
      response.writeHead(200, { "content-type": "application/vnd.docker.raw-stream", "x-docker-test": "stream" });
      response.write(Buffer.from([1, 0, 0, 0, 0, 0, 0, 3]));
      response.end("log");
    } else { response.writeHead(201, { "x-docker-test": "forwarded" }); response.end('{"Id":"owned"}'); }
  });
  await new Promise<void>((ok, fail) => { daemon.once("error", fail); daemon.listen(daemonSocket, ok); });
  cleanups.push(() => new Promise<void>((ok) => daemon.close(() => ok())));
  const proxy = createDockerProxy(daemonSocket);
  await new Promise<void>((ok, fail) => { proxy.once("error", fail); proxy.listen(proxySocket, ok); });
  cleanups.push(() => new Promise<void>((ok) => proxy.close(() => ok())));
  const send = (method: string, path: string, body?: string | object, chunked = false) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
    const bytes = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    const headers = { "content-type": "application/json", "x-request-test": "preserved", ...(chunked ? {} : { "content-length": String(Buffer.byteLength(bytes)) }) };
    const request = http.request({ socketPath: proxySocket, path, method, headers }, async (response) => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      ok({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) });
    });
    request.on("error", fail);
    if (chunked) { request.write(bytes.slice(0, 15)); request.write(bytes.slice(15)); request.end(); }
    else request.end(bytes);
  });
  return { send, received };
}

describe("Docker HTTP forwarding against a fake Unix-socket daemon", () => {
  it("forwards versioned paths, headers, rewritten JSON lengths, response headers, and raw streaming logs", async () => {
    const { send, received } = await setup();
    const response = await send("POST", `/v1.47/containers/create?name=${DB}`, createBody(), true);
    expect(response.status).toBe(201);
    expect(response.headers["x-docker-test"]).toBe("forwarded");
    const forwarded = received[0];
    expect(forwarded.path).toBe(`/v1.47/containers/create?name=${DB}`);
    expect(forwarded.headers["x-request-test"]).toBe("preserved");
    expect(forwarded.headers["transfer-encoding"]).toBeUndefined();
    expect(Number(forwarded.headers["content-length"])).toBe(forwarded.body.length);
    expect(JSON.parse(forwarded.body.toString()).HostConfig.PortBindings["5432/tcp"][0].HostIp).toBe("127.0.0.1");
    const logs = await send("GET", "/v1.47/containers/owned/logs?follow=1");
    expect(logs.headers["content-type"]).toBe("application/vnd.docker.raw-stream");
    expect(logs.body).toEqual(Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, 3]), Buffer.from("log")]));
  });

  it("rejects malformed JSON and unknown Docker mutations without forwarding their private bodies", async () => {
    const { send, received } = await setup();
    for (const [path, body] of [[`/containers/create?name=${DB}`, "{private-invalid-json"], ["/containers/owned/exec", { Cmd: ["private-command"] }], ["/networks/foreign/connect", {}], ["/containers/prune", {}], ["/build", {}]] as const) {
      const result = await send("POST", path, body);
      expect(result.status).toBe(403);
      expect(result.body.toString()).toBe('{"message":"Cadence Docker request rejected."}');
    }
    expect(received).toHaveLength(0);
  });

  it("checks both current ownership labels and loopback before lifecycle mutations", async () => {
    const { send, received } = await setup();
    expect((await send("POST", "/v1.47/containers/owned/start")).status).toBe(201);
    expect((await send("POST", "/containers/foreign/restart")).status).toBe(403);
    expect((await send("DELETE", "/containers/foreign")).status).toBe(403);
    expect((await send("POST", "/containers/unsafe/start")).status).toBe(403);
    expect((await send("POST", "/containers/unsafe/stop")).status).toBe(201);
    expect(received.filter((request) => request.method !== "GET").map((request) => request.path)).toEqual(["/v1.47/containers/owned/start", "/containers/unsafe/stop"]);
  });

  it("preserves the existing network and permits only owned volume creation and deletion", async () => {
    const { send, received } = await setup();
    expect((await send("POST", "/networks/create", { Name: "cadence-local", Labels: labels })).status).toBe(409);
    expect((await send("POST", "/networks/create", { Name: "other", Labels: labels })).status).toBe(403);
    expect((await send("POST", "/volumes/create", { Name: DB, Labels: labels })).status).toBe(201);
    expect((await send("DELETE", `/volumes/${DB}?force=1`)).status).toBe(201);
    expect((await send("DELETE", "/volumes/foreign")).status).toBe(403);
    expect((await send("POST", "/volumes/create", { Name: DB, Labels: labels, DriverOpts: { device: "/" } })).status).toBe(403);
    expect(received.some((request) => request.method === "POST" && request.path === "/networks/create")).toBe(false);
  });
});
