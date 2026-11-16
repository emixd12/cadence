import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../lib/db/database.types";
import { finishAgentRun, reserveAgentSpend, settleAgentSpend, startAgentRun, storeAgentRunContent } from "../lib/db/agent-runs.repo";
import { createAgentClient, createAgentContext } from "../lib/integrations/agent-caller";
import { executeMcpOperation } from "../lib/integrations/operations/execute";
import { beginDailyBriefAgentRun } from "../lib/services/daily-brief-agent-run";
import { parseIntegrationSigningKey, type IntegrationSigningKey } from "../lib/supabase/integration-token";

// Opt-in, advisor plan Phase 1A. Same isolated local project and variables as
// tests/integration-request-context.local-integration.test.ts (see
// docs/SUPABASE_WORKFLOW.md "Integration request tokens"), plus
// CADENCE_LOCAL_SUPABASE_DB_URL as in tests/integration-write.local-integration.test.ts. Refuses non-loopback
// URLs. The service-role client creates and deletes the test users and backs
// the per-grant rate limit, as in production.
// Writes revalidate Next.js paths, which needs a request outside Next.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localSigningKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const enabled = Boolean(localUrl && localServiceKey && localPublishableKey && localSigningKey && process.env.CADENCE_LOCAL_SUPABASE_DB_URL);
const localDescribe = enabled ? describe : describe.skip;

localDescribe("first-party agent caller against local Supabase", () => {
  let admin: SupabaseClient<Database>;
  let signingKey: IntegrationSigningKey;
  let userA: string;
  let userB: string;
  const createdUserIds: string[] = [];
  const runId = randomUUID().slice(0, 8);
  const options = () => ({ signingKey, runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! } });

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("The agent caller test only runs against loopback Supabase.");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", localUrl!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", localServiceKey!);
    signingKey = parseIntegrationSigningKey(localSigningKey!);
    admin = createClient<Database>(localUrl!, localServiceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    userA = await createUser(admin, `agent-a-${runId}@example.test`);
    createdUserIds.push(userA);
    userB = await createUser(admin, `agent-b-${runId}@example.test`);
    createdUserIds.push(userB);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin?.auth.admin.deleteUser(id);
    vi.unstubAllEnvs();
  });

  it("runs a read and a write as the person, under the agent's own label and scopes", async () => {
    const chat = await createAgentContext(userA, "chat", options());
    expect(chat.actor).toMatchObject({ channel: "chat", clientId: "cadence:agent:chat", clientLabel: "Cadence chat",
      grantedScopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write", "cadence.occurrences.move"] });

    const read = await executeMcpOperation("get_account_context", chat, {});
    expect(read.ok).toBe(true);

    const write = await executeMcpOperation("update_day_note", chat, {
      local_date: "2026-11-16", note: "Written by the chat agent", idempotency_key: `agent-${runId}`,
    });
    expect(write).toMatchObject({ ok: true, value: { changed: true, day_note: { note: "Written by the chat agent" } } });

    // The note is A's, read back through RLS; B's agent sees nothing.
    const { data } = await chat.supabase.from("day_notes").select("user_id, note").eq("local_date", "2026-11-16");
    expect(data).toEqual([{ user_id: userA, note: "Written by the chat agent" }]);
    const otherChat = await createAgentContext(userB, "chat", options());
    const { data: other } = await otherChat.supabase.from("day_notes").select("user_id").eq("local_date", "2026-11-16");
    expect(other).toEqual([]);

    // The Daily Brief agent is a different caller that reads and moves today's items only.
    const brief = await createAgentContext(userA, "daily_brief", options());
    expect(brief.actor).toMatchObject({ clientLabel: "Cadence Daily Brief", grantedScopes: ["cadence.read", "cadence.occurrences.move"] });
    expect(brief.actor.grantId).not.toBe(chat.actor.grantId);
    const refused = await executeMcpOperation("update_day_note", brief, { local_date: "2026-11-16", note: "Brief wrote this" });
    expect(refused).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });

    // Settings lists no agent grants: agents are not connected apps.
    const session = createAgentClient(userA, "chat", options()).client;
    const { data: grants, error } = await session.rpc("oauth_list_grants");
    expect(error).toBeNull();
    expect(grants).toEqual([]);
  });

  it("writes the Daily Brief run and its content through the agent channel", async () => {
    const run = await beginDailyBriefAgentRun({ userId: userA, trigger: "on_demand", model: "gpt-5.6-luna", promptVersion: "local-fixture",
      client: createAgentClient(userA, "daily_brief", options()).client });
    const generate = run!.wrap(async (input) => {
      input.onUsage?.({ inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 50 });
      return { text: "Fixture brief" };
    });
    await generate({ instructions: "fixture instructions", facts: "fixture facts", signal: new AbortController().signal });
    await run!.finish({ ok: true, briefing: { text: "Fixture brief" }, calendarDerived: false });

    // A second finish is refused because the first one wrote the row.
    const client = createAgentClient(userA, "daily_brief", options()).client;
    await expect(finishAgentRun(client, { runId: run!.runId, outcome: "error", errorCode: "late", errorReason: null, inputHash: null,
      modelCalls: 0, inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null })).resolves.toBe(false);
    // The run row and both content rows exist; the run's cost is the settled call.
    expect(databaseSql(`select agent || '|' || outcome || '|' || model_calls || '|' || input_tokens || '|' || cost_microdollars
      from cadence_advisor_private.agent_runs where id = '${run!.runId}'`)).toBe("daily_brief|success|1|1000|320");
    expect(databaseSql(`select string_agg(kind || ':' || calendar_derived, ',' order by kind)
      from cadence_advisor_private.agent_run_contents where run_id = '${run!.runId}'`)).toBe("input:false,output:false");
    // Another person's agent cannot touch the run.
    const other = createAgentClient(userB, "daily_brief", options()).client;
    await expect(storeAgentRunContent(other, { runId: run!.runId, kind: "output", body: {}, calendarDerived: false }))
      .rejects.toMatchObject({ code: "agent_run_not_found" });
  });

  it("refuses spend past the agent's share before any reservation is made", async () => {
    const client = createAgentClient(userB, "daily_brief", options()).client;
    const { runId: run } = await startAgentRun(client, { trigger: "on_demand", model: "gpt-5.6-luna", promptVersion: "local-fixture" });
    const first = await reserveAgentSpend(client, { runId: run, model: "gpt-5.6-luna", estimatedMicrodollars: 500_000 });
    expect(first.allowed).toBe(true);
    const second = await reserveAgentSpend(client, { runId: run, model: "gpt-5.6-luna", estimatedMicrodollars: 1 });
    expect(second).toMatchObject({ allowed: false, reason: "agent_share" });
    if (first.allowed) await expect(settleAgentSpend(client, { reservationId: first.reservationId, actualMicrodollars: 2_000 })).resolves.toBe(true);
    // Settled at US$0.002, the share has room again.
    await expect(reserveAgentSpend(client, { runId: run, model: "gpt-5.6-luna", estimatedMicrodollars: 1 })).resolves.toMatchObject({ allowed: true });
  });
});

// Private tables are not on the Data API; read them over the loopback database URL.
function databaseSql(sql: string): string {
  const databaseUrl = process.env.CADENCE_LOCAL_SUPABASE_DB_URL!;
  if (new URL(databaseUrl).hostname !== "127.0.0.1") throw new Error("Local database checks require loopback");
  return execFileSync("psql", [databaseUrl, "-XqAt", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}

async function createUser(admin: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: `Agent-${randomUUID()}`, email_confirm: true });
  if (error || !data.user) throw new Error(`Unable to create local test user: ${error?.message}`);
  return data.user.id;
}
