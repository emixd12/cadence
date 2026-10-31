import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { expect, it, vi } from "vitest";
import { PROJECT, main, readConfig, runHostedIsolation } from "../scripts/mcp-hosted-isolation.mjs";

const now = new Date("2026-10-28T01:00:00Z");
const note = "Review sample note";

function setup({ leakRead = false, leakWrite = false, acceptBadToken = false, timeoutAfterWrite = false, cleanupConflict = false, leakBehaviorWrite = false } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const users = [randomUUID(), randomUUID()];
  const fixtures = Object.fromEntries(["a", "b"].map((slot) => [slot,
    Object.fromEntries(["category", "walk", "reading", "stretch", "occurrence"].map((key) => [key, randomUUID()]))]));
  const args = ["--allow-hosted-project", PROJECT, "--qa-a", users[0], "--qa-b", users[1], "--fixtures", "fixture.json"];
  const env = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", CADENCE_INTEGRATION_JWT_SIGNING_KEY:
    JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: randomUUID() }) };
  const rows = new Map();
  for (const [index, slot] of ["a", "b"].entries()) {
    const f = fixtures[slot], user = users[index];
    rows.set(user, { id: user, timezone: "America/New_York" });
    rows.set(f.category, { id: f.category, user_id: user, name: "Review examples" });
    for (const [field, title] of [["walk", "Review walk"], ["reading", "Review reading"], ["stretch", "Review stretch"]]) {
      rows.set(f[field], { id: f[field], user_id: user, title, category_id: f.category,
        browser_reminder_enabled: false, email_reminder_enabled: false,
        active: field !== "stretch", archived_at: field === "stretch" ? now.toISOString() : null,
        description: null, updated_at: now.toISOString(), schedules: [{ id: randomUUID(),
          recurrence_rule: { frequency: "daily", interval: 1 }, sort_order: 0,
          time_entries: [{ id: randomUUID(), kind: "exact", preset: null, start_time: "09:00:00", end_time: null, sort_order: 0 }] }] });
    }
    rows.set(f.occurrence, { id: f.occurrence, user_id: user, behavior_id: f.walk, local_date: "2026-10-27", note });
  }
  const calls = [];
  const fetcher = vi.fn(async (url, init) => {
    const parsed = new URL(url);
    expect(parsed.origin).toBe(`https://${PROJECT}.supabase.co`);
    const rpc = parsed.pathname === "/rest/v1/rpc/update_behavior_with_schedule_graph";
    expect(parsed.pathname).toMatch(/^\/rest\/v1\/(profiles|categories|behaviors|occurrences|rpc\/update_behavior_with_schedule_graph)$/);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (!rpc) expect(parsed.searchParams.get("limit")).toBe("2");
    const body = init.body && JSON.parse(init.body);
    const id = rpc ? body.target_behavior_id : parsed.searchParams.get("id").slice(3);
    const jwt = init.headers.Authorization.slice(7);
    const [header, payload, signature] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.role).toBe("authenticated");
    expect(claims.exp - claims.iat).toBe(300);
    const valid = claims.exp > now.getTime() / 1000 && verify("sha256", Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    calls.push({ id, method: init.method, patch: init.body && JSON.parse(init.body) });
    if (!valid && !acceptBadToken) {
      const response = new Response("private-token-or-note", { status: 401 });
      response.json = () => { throw new Error("error body consumed"); };
      return response;
    }
    if (parsed.pathname.endsWith("/behaviors") && init.method === "PATCH") return new Response(null, { status: 403 });
    const row = rows.get(id);
    const allowed = (row.user_id ?? row.id) === claims.sub;
    if (rpc) {
      expect(init.method).toBe("POST");
      expect(body.behavior_payload.id).toBe(id);
      expect(body.expected_updated_at).toBe(row.updated_at);
      expect(body.expected_schedule_graph).toEqual(body.schedule_graph);
      if (!allowed && !leakBehaviorWrite) return Response.json(null);
      return Response.json(row);
    }
    if (!allowed && !(init.method === "PATCH" ? leakWrite : leakRead)) return Response.json([]);
    if (init.method === "PATCH") {
      const filter = parsed.searchParams.get("note");
      if (filter && filter !== (row.note === null ? "is.null" : `eq.${row.note}`)) return Response.json([]);
      Object.assign(row, JSON.parse(init.body));
      if (row.note === "Review confirmed" && timeoutAfterWrite) throw new Error("private-transport-token");
    } else if (row.note === "Review confirmed" && cleanupConflict) {
      row.note = "concurrent synthetic edit";
    }
    return Response.json([parsed.pathname.endsWith("/behaviors") && parsed.searchParams.get("select").includes("schedules:")
      ? structuredClone(row) : Object.fromEntries(parsed.searchParams.get("select").split(",").map((key) => [key, row[key]]))]);
  });
  return { args, env, fixtures, users, rows, calls, fetcher };
}

it("requires actual Node24 in the test worker", () => expect(process.versions.node.split(".")[0]).toBe("24"));

it.each(["missing-opt-in", "wrong-project", "missing-a", "missing-b", "same-users", "invalid-uuid", "extra-option", "service-key", "duplicate-id", "extra-fixture"])("refuses %s before networking", async (fault) => {
  const t = setup();
  if (fault === "missing-opt-in") t.args.splice(0, 2);
  if (fault === "wrong-project") t.args[1] = "another-project";
  if (fault === "missing-a") t.args.splice(2, 2);
  if (fault === "missing-b") t.args.splice(4, 2);
  if (fault === "same-users") t.args[5] = t.args[3];
  if (fault === "invalid-uuid") t.args[3] = "not-a-user";
  if (fault === "extra-option") t.args.push("--url", "https://attacker.example");
  if (fault === "service-key") t.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_forbidden";
  if (fault === "duplicate-id") t.fixtures.b.walk = t.fixtures.a.walk;
  if (fault === "extra-fixture") t.fixtures.a.customer = randomUUID();
  if (["missing-a", "missing-b", "invalid-uuid"].includes(fault)) {
    expect(() => readConfig(t.args, t.env, t.fixtures)).toThrow(/^qa-identities-required$/);
  }
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now)).rejects.toThrow();
  expect(t.fetcher).not.toHaveBeenCalled();
});

it("proves positive writes, cross-account denial and signature/expiry rejection, then restores only A's note", async () => {
  const t = setup();
  const before = structuredClone([...t.rows]);
  const result = await runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now);
  expect(result.result).toBe("passed");
  expect(result.requests).toBeLessThan(60);
  expect([...t.rows]).toEqual(before);
  expect(t.calls.filter((c) => c.patch?.note === "Review confirmed")).toEqual([
    { id: t.fixtures.a.occurrence, method: "PATCH", patch: { note: "Review confirmed" } },
  ]);
  expect(new Set(t.calls.map((c) => c.id))).toEqual(new Set([...t.users, ...Object.values(t.fixtures.a), ...Object.values(t.fixtures.b)]));
});

it.each(["reminders", "title", "ownership", "old-date", "private-note"])("refuses unsafe fixture %s before writes", async (fault) => {
  const t = setup({ leakRead: fault === "ownership" });
  const walk = t.rows.get(t.fixtures.b.walk), occurrence = t.rows.get(t.fixtures.a.occurrence);
  if (fault === "reminders") walk.browser_reminder_enabled = true;
  if (fault === "title") walk.title = "unapproved fixture";
  if (fault === "ownership") walk.user_id = t.users[0];
  if (fault === "old-date") occurrence.local_date = "2020-01-01";
  if (fault === "private-note") occurrence.note = "private customer note";
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now)).rejects.toThrow(
    fault === "old-date" || fault === "private-note" ? /^fixture-occurrence$/ : /^fixture-behavior$/);
  expect(t.calls.every((c) => c.method === "GET")).toBe(true);
});

it.each(["leakRead", "leakWrite", "leakBehaviorWrite", "acceptBadToken"])("detects broken isolation %s without returning Passed", async (fault) => {
  const t = setup({ [fault]: true });
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now)).rejects.toThrow();
  expect(t.rows.get(t.fixtures.a.occurrence).note).toBe(note);
});

it("does not retry an ambiguous note write and restores only after reading its outcome", async () => {
  const t = setup({ timeoutAfterWrite: true });
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now)).rejects.toThrow("private-transport-token");
  expect(t.calls.filter((c) => c.patch?.note === "Review confirmed")).toHaveLength(1);
  expect(t.rows.get(t.fixtures.a.occurrence).note).toBe(note);
});

it("refuses to overwrite a concurrent note change during cleanup", async () => {
  const t = setup({ cleanupConflict: true });
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now)).rejects.toThrow("cleanup-conflict");
  expect(t.rows.get(t.fixtures.a.occurrence).note).toBe("concurrent synthetic edit");
});

it("restores an initially null note with an exact null compare-and-swap", async () => {
  const t = setup();
  t.rows.get(t.fixtures.a.occurrence).note = null;
  await runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now);
  expect(t.rows.get(t.fixtures.a.occurrence).note).toBeNull();
});

it.each(["too-large", "multiple-rows", "invalid-json"])("rejects %s responses before writing", async (fault) => {
  const t = setup();
  const fetcher = vi.fn(async () => new Response(fault === "too-large" ? "x".repeat(16_385)
    : fault === "multiple-rows" ? '[{},{}]' : 'private-malformed-response'));
  await expect(runHostedIsolation(t.args, t.env, t.fixtures, fetcher, now)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});

it("uses only the fixed diagnostic in CLI failure output", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await main(["--fixtures", "/missing/private-key-or-note"], {})).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("private-key-or-note");
    expect(error.mock.calls[0][0]).toMatch(/^Hosted isolation did not pass;/);
    expect(log).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); }
});

it("validates the explicit manifest without requiring network access", () => {
  const t = setup();
  expect(readConfig(t.args, t.env, t.fixtures).users).toEqual(t.users);
  expect(() => readConfig(t.args, {}, t.fixtures)).toThrow("publishable-key-required");
});

it("uses the same supported Behavior RPC for own success and cross-account denial", async () => {
  const t = setup();
  await runHostedIsolation(t.args, t.env, t.fixtures, t.fetcher, now);
  const writes = t.calls.filter((call) => call.patch?.target_behavior_id);
  expect(writes).toHaveLength(6);
  expect(writes.every((call) => call.method === "POST")).toBe(true);
  expect(new Set(writes.map((call) => call.id))).toEqual(new Set([
    t.fixtures.a.walk, t.fixtures.a.reading, t.fixtures.a.stretch,
    t.fixtures.b.walk, t.fixtures.b.reading, t.fixtures.b.stretch,
  ]));
});
