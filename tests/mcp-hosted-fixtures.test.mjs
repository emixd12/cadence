import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildFixtureBundle, FIXTURE_SOURCE } from "../scripts/build-mcp-hosted-fixtures.mjs";

const USERS = ["caefd1b8-ea46-485f-8869-119a715fb092", "c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b"];
const CATEGORY = { id: "a29dd2d0-5425-4180-a29a-01a026ebb8c0", user_id: USERS[0], created_at: "2026-10-28T02:17:19.262435+00:00" };
const RUN = { runId: "4db9fe6e-a966-4cca-938b-aee5a1b955b7", startedAt: "2026-10-28T02:17:18.882Z", D: "2026-10-27", users: USERS, source: FIXTURE_SOURCE };
let runFixtures, buildRoot, receipt;
beforeAll(async () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  mkdirSync(".intent/artifacts", { recursive: true });
  buildRoot = mkdtempSync(".intent/artifacts/fixture-bundle-test-");
  const output = join(buildRoot, "fixtures.mjs");
  receipt = buildFixtureBundle(output);
  ({ runFixtures } = await import(pathToFileURL(join(process.cwd(), output)).href));
});
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));

async function attempt({ mode = "resume", changeCategory, changeFiles, changeInput, bCategory = false, behavior = false, now = "2026-10-28T02:25:00Z" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "fixture-resume-test-"));
  const files = { "execution": RUN, "fixture-ids": { a: { category: CATEGORY.id } }, "creation-receipts": [{ path: "/rest/v1/categories", ...CATEGORY }] };
  const category = { ...CATEGORY, name: "Review examples", updated_at: CATEGORY.created_at };
  changeCategory?.(category);
  const input = { mode, allowHostedProject: "qjodzutjxtmtzczbloxa", publishableKey: "sb_publishable_OFFLINE",
    sessions: USERS.map(userId => ({ userId, accessToken: `e30.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: 4102444800 })).toString("base64url")}.offline` })) };
  changeInput?.(input);
  const copied = structuredClone(files);
  changeFiles?.(copied);
  for (const [name, value] of Object.entries(copied)) writeFileSync(join(directory, `${name}.json`), JSON.stringify(value));
  const calls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url), method = options.method ?? "GET";
    const auth = new Headers(options.headers).get("authorization");
    const user = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub;
    calls.push({ path: parsed.pathname, method, ...(options.body ? { payload: JSON.parse(options.body) } : {}) });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (method === "POST" && parsed.pathname === "/rest/v1/rpc/create_behavior_with_schedule_graph") {
      return json({ message: "SECRET_PROVIDER_ERROR_WITH_NOTE_TEXT" }, 400);
    }
    expect(method).toBe("GET");
    if (parsed.pathname === "/auth/v1/user") return json({ id: user });
    if (parsed.pathname === "/rest/v1/profiles") return json({ id: user, timezone: "America/New_York" });
    if (parsed.pathname === "/rest/v1/categories") return json(user === USERS[0] || bCategory ? [category] : []);
    if (parsed.pathname === "/rest/v1/behaviors") return json(behavior ? [{ id: "existing" }] : []);
    throw new Error("Unexpected offline request");
  };
  try {
    const result = await runFixtures(input, { directory, fetcher, now: new Date(now) });
    const writes = calls.filter(c => c.method !== "GET");
    const persisted = Object.fromEntries(Object.keys(files).map(name => [name, JSON.parse(readFileSync(join(directory, `${name}.json`)))]));
    const second = mode === "resume" && writes.length ? await runFixtures(input, { directory, fetcher, now: new Date("2026-10-28T02:25:01Z") }) : null;
    return { result, calls, writes, persisted, second };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

it("builds only frozen product inputs and checks installed runtime dependency versions", () => {
  expect(receipt.source).toBe(FIXTURE_SOURCE);
  expect(receipt.inputs.some(i => i.path === "packages/core/src/services/configuration-payload.ts")).toBe(true);
  expect(receipt.inputs.every(i => /^(lib|packages\/core)\//.test(i.path))).toBe(true);
  expect(receipt.dependencies["@supabase/supabase-js"]).toBe("2.107.0");
});
it("reuses A's exact category and sends a coherent frozen RPC payload without recreating it", async () => {
  const { result, writes, persisted, second } = await attempt();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe("/rest/v1/rpc/create_behavior_with_schedule_graph");
  const plan = writes[0].payload.configuration_event_plan;
  expect(plan.changed_fields).toContain("where_kind");
  expect(plan.next_configuration).toHaveProperty("where_kind", null);
  expect(writes[0].payload.behavior_payload.category_id).toBe(CATEGORY.id);
  expect(result).toMatchObject({ result: "stopped", stage: "a-walk", lastRequest: { status: 400 } });
  expect(JSON.stringify(result)).not.toContain("SECRET_PROVIDER_ERROR");
  expect(persisted.execution).toEqual(RUN);
  expect(persisted["creation-receipts"]).toEqual([{ path: "/rest/v1/categories", ...CATEGORY }]);
  expect(second).toMatchObject({ result: "stopped", stage: "input", requests: 0 });
});
it("preflight has no writes", async () => {
  const { result, writes } = await attempt({ mode: "preflight" });
  expect(result.result).toBe("preflight-passed"); expect(writes).toHaveLength(0);
});
it("refuses a local-day rollover without rebasing the recorded run", async () => {
  const { result, calls } = await attempt({ now: "2026-10-28T04:00:00Z" });
  expect(result).toMatchObject({ result: "stopped", stage: "input", requests: 0 });
  expect(calls).toHaveLength(0);
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
