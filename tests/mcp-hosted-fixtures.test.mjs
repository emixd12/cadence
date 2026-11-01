import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { partialGraph, addGeneratedOccurrences } from "./helpers/mcp-fixture-partial.mjs";
import { buildFixtureBundle, FIXTURE_SOURCE, FIXTURE_RUNTIME_IMPORTS, verifyFixtureDependencies } from "../scripts/build-mcp-hosted-fixtures.mjs";

const USERS = ["caefd1b8-ea46-485f-8869-119a715fb092", "c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b"];
const CATEGORY = { id: "a29dd2d0-5425-4180-a29a-01a026ebb8c0", user_id: USERS[0], created_at: "2026-10-28T02:17:19.262435+00:00" };
const RUN = { runId: "4db9fe6e-a966-4cca-938b-aee5a1b955b7", startedAt: "2026-10-28T02:17:18.882Z", D: "2026-10-27", users: USERS, source: FIXTURE_SOURCE };
let runFixtures, buildRoot, receipt, bundle;
beforeAll(async () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  mkdirSync(".intent/artifacts", { recursive: true });
  buildRoot = mkdtempSync(".intent/artifacts/fixture-bundle-test-");
  const output = join(buildRoot, "fixtures.mjs");
  receipt = buildFixtureBundle(output);
  bundle = await import(pathToFileURL(join(process.cwd(), output)).href);
  ({ runFixtures } = bundle);
});
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));

async function attempt({ mode = "resume", changeCategory, changeFiles, changeInput, bCategory = false, behavior = false, changeGraph, now = "2026-10-28T21:25:00Z" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "fixture-resume-test-"));
  const files = { "execution": RUN, "fixture-ids": { a: { category: CATEGORY.id } }, "creation-receipts": [{ path: "/rest/v1/categories", ...CATEGORY }], "resume-started": bundle.PRIOR_RESUME, "resume-fixture-ids": bundle.PARTIAL_IDS };
  const graph = partialGraph(bundle); addGeneratedOccurrences(graph, bundle); changeGraph?.(graph);
  const category = { ...CATEGORY, name: "Review examples", updated_at: CATEGORY.created_at };
  changeCategory?.(category);
  const input = { mode, executionDate: "2026-10-28", allowHostedProject: "qjodzutjxtmtzczbloxa", publishableKey: "sb_publishable_OFFLINE",
    sessions: USERS.map(userId => ({ userId, accessToken: `e30.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: 4102444800 })).toString("base64url")}.offline` })) };
  changeInput?.(input);
  const copied = structuredClone(files);
  changeFiles?.(copied);
  for (const [name, value] of Object.entries(copied)) writeFileSync(join(directory, `${name}.json`), JSON.stringify(value));
  const originalBytes = Object.fromEntries(Object.keys(files).map(name => [name, readFileSync(join(directory, `${name}.json`), "utf8")]));
  const calls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url), method = options.method ?? "GET";
    const auth = new Headers(options.headers).get("authorization");
    const user = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub;
    calls.push({ path: parsed.pathname, method, ...(options.body ? { payload: JSON.parse(options.body) } : {}) });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (method === "POST") return json({ message: "SECRET_PROVIDER_ERROR_WITH_NOTE_TEXT" }, 400);
    expect(method).toBe("GET");
    if (parsed.pathname === "/auth/v1/user") return json({ id: user });
    if (parsed.pathname === "/rest/v1/profiles") return json({ id: user, timezone: "America/New_York" });
    if (parsed.pathname === "/rest/v1/categories" && !parsed.searchParams.has("id")) return json(user === USERS[0] || bCategory ? [category] : []);
    if (parsed.pathname === "/rest/v1/behaviors" && !parsed.searchParams.has("id")) return json(behavior ? [{ id: "existing" }] : user === USERS[0] ? [{ id: bundle.PARTIAL_IDS.a.walk }] : []);
    const table = parsed.pathname.split("/").at(-1);
    if (graph[table]) return json(graph[table]);
    throw new Error("Unexpected offline request");
  };
  try {
    const result = await runFixtures(input, { directory, fetcher, now: new Date(now) });
    const writes = calls.filter(c => c.method !== "GET");
    const persisted = Object.fromEntries(Object.keys(files).map(name => [name, JSON.parse(readFileSync(join(directory, `${name}.json`)))]));
    const bytesUnchanged = Object.keys(files).every(name => readFileSync(join(directory, `${name}.json`), "utf8") === originalBytes[name]);
    const resumeReceipt = existsSync(join(directory, "completion-started.json")) ? JSON.parse(readFileSync(join(directory, "completion-started.json"))) : null;
    const second = mode === "resume" && writes.length ? await runFixtures(input, { directory, fetcher, now: new Date("2026-10-28T21:25:01Z") }) : null;
    return { result, calls, writes, persisted, second, bytesUnchanged, resumeReceipt };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

it("builds only frozen product inputs and checks installed runtime dependency versions", () => {
  expect(receipt.source).toBe(FIXTURE_SOURCE);
  expect(receipt.inputs.some(i => i.path === "packages/core/src/services/configuration-payload.ts")).toBe(true);
  expect(receipt.inputs.every(i => /^(lib|packages\/core)\//.test(i.path))).toBe(true);
  expect(receipt.dependencies["@supabase/supabase-js"]).toBe("2.107.0");
  expect(receipt.dependencies["@supabase/phoenix"]).toBe("0.4.2");
  expect(receipt.runtimeImports).toEqual(FIXTURE_RUNTIME_IMPORTS);
  const built = readFileSync(join(buildRoot, "fixtures.mjs"), "utf8");
  expect(built).toContain('from "@cadence-fixture/supabase-js"');
  expect(built).not.toContain('from "@supabase/supabase-js"');
});

function runtimeGraph(change = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "fixture-dependencies-test-"));
  const lock = { packages: {} };
  const install = (location, name, version, dependencies = {}) => {
    const target = join(directory, "node_modules", location);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify({ name, version, dependencies, exports: "./index.js" }));
    writeFileSync(join(target, "index.js"), "throw new Error('dependency verification must not execute packages');\n");
    return target;
  };
  try {
    install("@cadence-fixture/supabase-js", "@supabase/supabase-js", "2.107.0", { "@supabase/auth-js": "2.107.0" });
    const nested = "@cadence-fixture/supabase-js/node_modules/@supabase/auth-js";
    install(nested, "@supabase/auth-js", "2.107.0");
    install("@supabase/supabase-js", "@supabase/supabase-js", "2.118.0");
    install("@supabase/auth-js", "@supabase/auth-js", "2.118.0");
    install("@js-temporal/polyfill", "@js-temporal/polyfill", "0.5.1");
    lock.packages = {
      "node_modules/@supabase/supabase-js": { version: "2.107.0", dependencies: { "@supabase/auth-js": "2.107.0" } },
      "node_modules/@supabase/auth-js": { version: "2.107.0" },
      "node_modules/@js-temporal/polyfill": { version: "0.5.1" },
    };
    change({ install, lock, directory, nested });
    return verifyFixtureDependencies(lock, join(directory, "fixtures.mjs"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

it("checks the nested frozen graph while newer application packages are hoisted", () => {
  expect(runtimeGraph()).toEqual({
    "@supabase/supabase-js": "2.107.0", "@supabase/auth-js": "2.107.0", "@js-temporal/polyfill": "0.5.1",
  });
});
it("refuses a nested dependency with a different version", () => {
  expect(() => runtimeGraph(({ install, nested }) => install(nested, "@supabase/auth-js", "2.118.0")))
    .toThrow("fixture-dependency-drift");
});
it("refuses a missing nested dependency that would resolve to the newer application package", () => {
  expect(() => runtimeGraph(({ directory, nested }) => rmSync(join(directory, "node_modules", nested), { recursive: true })))
    .toThrow("fixture-dependency-drift");
});
it("refuses an installed dependency declaration that differs from the frozen lock", () => {
  expect(() => runtimeGraph(({ install, nested }) => install(nested, "@supabase/auth-js", "2.107.0", { unexpected: "1.0.0" })))
    .toThrow("fixture-dependency-drift");
});
it("reuses the exact partial graph and submits only the remaining status through the frozen planner", async () => {
  const { result, writes, persisted, second, bytesUnchanged, resumeReceipt } = await attempt();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe("/rest/v1/rpc/apply_occurrence_status_transition");
  const p = writes[0].payload;
  expect(p.target_occurrence_id).toBe("8b4d5d5e-d13b-4ab3-bbe4-66b86f337e7d");
  expect(p.planned_status).toBe("not_completed");
  expect(p.planned_completed_at).toBeNull();
  expect(p.planned_event_effective_at).toBeTruthy();
  expect(p.planned_event_effective_at).toBe(p.planned_status_marked_at);
  expect(p.planned_event_recorded_at).toBe(p.planned_status_marked_at);
  expect(result).toMatchObject({ result: "stopped", stage: "a-walk", lastRequest: { status: 400 } });
  expect(JSON.stringify(result)).not.toContain("SECRET_PROVIDER_ERROR");
  expect(persisted.execution).toEqual(RUN);
  expect(bytesUnchanged).toBe(true);
  expect(resumeReceipt).toEqual({ initialD: "2026-10-27", D: "2026-10-28", actualNewYorkDate: "2026-10-28", captureDeadline: bundle.CAPTURE_DEADLINE, resumedAt: "2026-10-28T21:25:00.000Z", runId: RUN.runId, source: FIXTURE_SOURCE, priorResume: bundle.PRIOR_RESUME.resumedAt });
  expect(second).toMatchObject({ result: "stopped", stage: "input", requests: 0 });
});
it("preflight has no writes", async () => {
  const { result, writes } = await attempt({ mode: "preflight" });
  expect(result.result).toBe("preflight-passed"); expect(writes).toHaveLength(0);
});
it.each(["2026-10-28T03:59:59Z", "2026-10-29T04:00:00Z"])("refuses October27 and October29 in New York before any request: %s", async now => {
  const { result, calls } = await attempt({ now });
  expect(result).toMatchObject({ result: "stopped", stage: "input", requests: 0 });
  expect(calls).toHaveLength(0);
});
it.each([
  g => { g.occurrences.pop(); },
  g => { g.occurrences[0].created_at = "2026-10-28T18:11:35+00:00"; },
  g => { g.occurrences[0].status = "completed"; },
  g => { g.occurrences[0].note = "Changed"; },
  g => { g.occurrence_status_events[0].effective_at = "2026-10-25T14:00:00Z"; },
  g => { g.behaviors[0].user_id = USERS[1]; },
  g => { g.behavior_schedule_slots[0].start_time = "10:00:00"; },
  g => { g.behavior_definition_events[0].next_title = "Changed"; },
  g => { g.behavior_configuration_events[0].next_configuration.email_reminder_enabled = true; },
  g => { g.occurrence_time_sessions.push({ id: USERS[0] }); },
])("refuses a partial graph mismatch before any write", async changeGraph => {
  const { result, writes } = await attempt({ changeGraph });
  expect(result).toMatchObject({ result: "stopped", stage: "session-and-fixture-preflight" });
  expect(writes).toHaveLength(0);
});
it.each([
  c => { c.id = USERS[1]; }, c => { c.user_id = USERS[1]; }, c => { c.name = "Changed"; },
  c => { c.created_at = "2026-10-28T02:17:19.262436+00:00"; },
  c => { c.updated_at = "2026-10-28T02:17:19.262436+00:00"; },
])("refuses any captured category identity, owner, name or timestamp mismatch", async changeCategory => {
  const { result, writes } = await attempt({ changeCategory });
  expect(result).toMatchObject({ result: "stopped", stage: "session-and-fixture-preflight" });
  expect(writes).toHaveLength(0);
});
it.each([
  f => { f.execution.runId = USERS[0]; }, f => { f.execution.source = "another-source"; },
  f => { f["fixture-ids"].a.walk = USERS[0]; }, f => { f["creation-receipts"] = []; },
  f => { f["resume-fixture-ids"].a.walk = USERS[1]; },
  f => { f["resume-started"].D = "2026-10-27"; },
  f => { f["creation-receipts"][0].created_at = "2026-10-28T01:00:00Z"; },
])("refuses changed or incomplete retained receipts before any request", async changeFiles => {
  const { result, calls } = await attempt({ changeFiles });
  expect(result).toMatchObject({ result: "stopped", stage: "input", requests: 0 }); expect(calls).toHaveLength(0);
});
it.each([{ bCategory: true }, { behavior: true }])("refuses any other fixture collision", async options => {
  const { result, writes } = await attempt(options);
  expect(result.result).toBe("stopped"); expect(writes).toHaveLength(0);
});
it.each([
  i => { delete i.allowHostedProject; }, i => { i.sessions[0].userId = USERS[1]; },
  i => { i.mode = "seed"; }, i => { i.publishableKey = "service-role"; },
])("refuses wrong scope or credentials before any request", async changeInput => {
  const { result, calls } = await attempt({ changeInput });
  expect(result).toMatchObject({ result: "stopped", stage: "input", requests: 0 }); expect(calls).toHaveLength(0);
});

it("accepts the explicit current date and 30 generated rows without changing the original status targets", async () => {
  const r = await attempt({ now: "2026-10-29T14:00:00Z", changeInput: i => { i.executionDate = "2026-10-29"; } });
  expect(r.writes).toHaveLength(1);
  expect(r.writes[0].payload.target_occurrence_id).toBe("8b4d5d5e-d13b-4ab3-bbe4-66b86f337e7d");
  expect(r.resumeReceipt).toMatchObject({ initialD: "2026-10-27", D: "2026-10-29", actualNewYorkDate: "2026-10-29" });
  expect(r.bytesUnchanged).toBe(true);
});
it.each([
  i => { delete i.executionDate; }, i => { i.executionDate = "2026-10-29"; }, i => { i.executionDate = "2026-10-30"; },
])("requires an explicit matching date before any request", async changeInput => {
  expect((await attempt({ changeInput })).result).toMatchObject({ result: "stopped", stage: "input", requests: 0 });
});
it("refuses after the extended deadline before any request", async () => {
  expect((await attempt({ now: "2026-11-04T02:17:18.883Z", changeInput: i => { i.executionDate = "2026-11-03"; } })).result)
    .toMatchObject({ result: "stopped", stage: "input", requests: 0 });
});
it.each([
  g => { g.occurrences.at(-1).user_id = USERS[1]; },
  g => { g.occurrences.at(-1).behavior_id = USERS[0]; },
  g => { g.occurrences.at(-1).status = "completed"; },
  g => { g.occurrences.at(-1).note = "changed"; },
  g => { g.occurrences.at(-1).updated_at = "2026-10-29T13:00:00Z"; },
  g => { g.occurrences.at(-1).scheduled_for = "2026-11-27T15:00:00Z"; },
  g => { g.occurrences.at(-1).schedule_start_time = "10:00:00"; },
  g => { g.occurrences.at(-1).created_at = "2026-10-28T01:00:00Z"; },
  g => { g.occurrences.push({ ...g.occurrences.at(-1), id: USERS[0] }); },
])("refuses unsafe generated descendants before writes", async mutate => {
  const r = await attempt({ now: "2026-10-29T14:00:00Z", changeInput: i => { i.executionDate = "2026-10-29"; }, changeGraph: g => { mutate(g); } });
  expect(r.result).toMatchObject({ result: "stopped", stage: "session-and-fixture-preflight" }); expect(r.writes).toHaveLength(0);
});
it("refreshes only unchanged captured rows plus attributed generated Occurrences; retains no text", () => {
  const graph = partialGraph(bundle);
  const previous = bundle.graphReceipt(graph, "2026-10-28T18:12:00Z");
  addGeneratedOccurrences(graph, bundle);
  const next = bundle.refreshGraphReceipt(previous, graph, new Date("2026-10-29T14:00:00Z"));
  expect(next.appGenerated).toHaveLength(30);
  expect(next.appGenerated.every(r => r.provenance === "app-generated")).toBe(true);
  expect(JSON.stringify(next)).not.toContain("Review sample note");
  for (const mutate of [g => { g.occurrences.shift(); }, g => { g.occurrences[0].note = "changed"; },
    g => { g.occurrences[0].status = "completed"; }, g => { g.behaviors[0].title = "changed"; },
    g => { g.behaviors.push({ ...g.behaviors[0], id: USERS[1] }); }]) {
    const copy = structuredClone(graph); mutate(copy);
    expect(() => bundle.refreshGraphReceipt(previous, copy, new Date("2026-10-29T14:00:00Z"))).toThrow();
  }
});

it.each([
  g => { g.occurrences = g.occurrences.filter(o => o.id !== bundle.KNOWN_GENERATED_ROWS.at(-1).id); },
  g => { g.occurrences.find(o => o.id === bundle.KNOWN_GENERATED_ROWS.at(-1).id).id = USERS[1]; },
  g => { g.occurrences.find(o => o.id === bundle.KNOWN_GENERATED_ROWS.at(-1).id).created_at = '2026-10-28T21:00:00Z'; },
  g => { g.occurrences.find(o => o.id === bundle.KNOWN_GENERATED_ROWS.at(-1).id).local_date = '2026-11-28'; },
])('refuses deletion, replacement or metadata edits of already captured generated rows before writes', async changeGraph => {
  const r = await attempt({ now: '2026-10-29T14:00:00Z', changeInput: i => { i.executionDate = '2026-10-29'; }, changeGraph });
  expect(r.result).toMatchObject({ result: 'stopped', stage: 'session-and-fixture-preflight' });
  expect(r.writes).toHaveLength(0);
});
it('accepts the unchanged38 and a genuinely new valid descendant', async () => {
  const r = await attempt({ mode: 'preflight', now: '2026-10-29T14:00:00Z', changeInput: i => { i.executionDate = '2026-10-29'; }, changeGraph: g => {
    g.occurrences.push({ ...g.occurrences.at(-1), id: USERS[1], local_date: '2026-11-28', scheduled_for: '2026-11-28T14:00:00Z',
      created_at: '2026-10-29T13:00:00Z', updated_at: '2026-10-29T13:00:00Z' });
  } });
  expect(r.result.result).toBe('preflight-passed'); expect(r.writes).toHaveLength(0);
});
