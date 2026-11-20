import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { evaluateBehaviorChangeCandidate, toProposeBehaviorChangeInput } from "@cadence/core/services/behavior-change-proposal";
import type { Database } from "@/lib/db/database.types";
import { startAgentRun } from "@/lib/db/agent-runs.repo";
import { coachProposeBehaviorChange } from "@/lib/db/behavior-change-proposals.repo";
import { getBehaviorById, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createAgentClient } from "@/lib/integrations/agent-caller";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import { readOperationHandlers } from "@/lib/integrations/operations/read";
import { approveOAuthConsent, registerOAuthClient } from "@/lib/db/oauth.repo";
import { parseIntegrationSigningKey } from "@/lib/supabase/integration-token";
import { answerScheduleProposal, proposalSchedules } from "@/lib/services/behavior-change-proposals.service";

// "Tips with one-tap changes" (Nov 20) against an isolated local Supabase:
//   - a Yes applies today: today's unmarked, future Occurrence moves to the new time;
//   - a day already moved by hand keeps its move through the schedule change, with no
//     second copy, and the outcome says the change starts tomorrow;
//   - Undo after Change for good puts today's Occurrence back at the old time.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;

/** An Etc/GMT zone where the local time is about 10:00, so 14:00 to 18:00 are still ahead. */
function morningZone(now: Temporal.Instant): string {
  const utcHour = now.toZonedDateTimeISO("UTC").hour;
  let offset = 10 - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

localDescribe("tip questions applied today on isolated local Supabase", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let person: AppSupabaseClient;
  let coach: AppSupabaseClient;
  let mcp: IntegrationContext;
  let userId: string;
  let timezone: string;
  let today: string;
  const clientId = `dcr-one-tap-${randomUUID()}`;
  const call = async (name: keyof typeof writeOperationHandlers, input: unknown) => {
    const result = await writeOperationHandlers[name]({ ...mcp, now: new Date() }, input);
    if (!result.ok) throw new Error(`${name} failed: ${JSON.stringify(result.error)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.value as Record<string, any>;
  };
  const occurrencesToday = async (behaviorId: string) => {
    const { data, error } = await admin.from("occurrences").select("*").eq("user_id", userId)
      .eq("behavior_id", behaviorId).eq("local_date", today).order("scheduled_for");
    if (error) throw error;
    return data;
  };
  const localInstant = (time: string) => Temporal.PlainDate.from(today).toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(timezone).toInstant().toString();
  const caller = () => ({ supabase: person, userId, now: Temporal.Now.instant() });

  /** Stores a tip-backed question moving every day's `from` to `to`, as the tip run would. */
  async function propose(behaviorId: string, from: string, to: string): Promise<string> {
    const behavior = await getBehaviorById(person, userId, behaviorId);
    if (!behavior) throw new Error("fixture Behavior missing");
    const decision = evaluateBehaviorChangeCandidate({
      today, behavior: { id: behavior.id, title: behavior.title, active: true, schedules: proposalSchedules(behavior) },
      change: { weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], fromTime: from, toTime: to },
      evidence: { source: "tip", signalKind: "repeated_move", signalIds: [], cardId: "set-it-where-you-keep-moving-it",
        tipText: `You moved ${behavior.title} to about ${to} on 3 days in the last 4 weeks.`, counts: { moved_days: 3 } },
      hasOpenProposal: false, declined: [],
    });
    if (!decision.ok) throw new Error(decision.reason);
    const run = await startAgentRun(coach, { trigger: "scheduled", model: null, promptVersion: "coach-tips-2" });
    const input = toProposeBehaviorChangeInput(decision.plan, today, run.runId);
    expect(input.first_affected_date).toBe(today);
    const stored = await coachProposeBehaviorChange(coach, run.runId, input);
    if (!("id" in stored)) throw new Error(`refused: ${JSON.stringify(stored)}`);
    return stored.id;
  }

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local writes require loopback.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = Temporal.Now.instant();
    timezone = morningZone(now);
    today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
    const email = `one-tap-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create local fixture user.");
    userId = created.data.user.id;
    const profile = await admin.from("profiles").update({ timezone }).eq("id", userId);
    if (profile.error) throw profile.error;
    const session = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await session.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    person = session as unknown as AppSupabaseClient;
    const options = { signingKey: parseIntegrationSigningKey(signingKey!), runtimeConfig: { url: url!, publishableKey: publishableKey! } };
    coach = createAgentClient(userId, "coach", options).client as unknown as AppSupabaseClient;
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "One-tap test", clientUri: null,
      logoUri: null, redirectUris: ["https://client.example/callback"], applicationType: "web", metadata: {},
      verifiedClient: null, metadataExpiresAt: null });
    const grant = { userId, grantId: randomUUID(), clientId, clientLabel: "One-tap test", channel: "mcp" as const,
      scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] as const };
    const contextOptions = { now: new Date(), ...options };
    const temporary = createIntegrationContext(grant, contextOptions);
    const consent = await approveOAuthConsent(temporary.supabase, { clientId, redirectUri: "https://client.example/callback",
      codeChallenge: "a".repeat(43), resource: "https://app.cadence-me.com/mcp", scopes: [...grant.scopes], codeHash: randomUUID().replaceAll("-", "").repeat(2) });
    mcp = createIntegrationContext({ ...grant, grantId: consent.grantId }, contextOptions);
  }, 30_000);

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("a Yes moves today's unmarked, future Occurrence; Undo puts it back", async () => {
    const behavior = (await call("create_behavior", {
      title: "Read", default_duration_minutes: 30,
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "14:00" }] }],
    })).behavior;
    const [planned] = await occurrencesToday(behavior.id);
    expect(planned).toBeDefined();
    const proposalId = await propose(behavior.id, "14:00", "18:00");

    const result = await answerScheduleProposal(caller(), { proposalId, answer: "for_good" });
    expect(result).toMatchObject({ applied: true, undoable: true, message: "Read is at 6:00 PM every day, starting today." });
    const after = await occurrencesToday(behavior.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("unresolved");
    expect(Temporal.Instant.from(after[0]!.scheduled_for).toString()).toBe(localInstant("18:00"));

    const undone = await answerScheduleProposal(caller(), { proposalId, answer: "undo" });
    expect(undone).toMatchObject({ applied: true, message: "Read is back at 2:00 PM." });
    const back = await occurrencesToday(behavior.id);
    expect(back).toHaveLength(1);
    expect(Temporal.Instant.from(back[0]!.scheduled_for).toString()).toBe(localInstant("14:00"));
  }, 60_000);

  it("a day already moved by hand keeps its move, and the change starts tomorrow", async () => {
    const behavior = (await call("create_behavior", {
      title: "Gym", default_duration_minutes: 60,
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "15:00" }] }],
    })).behavior;
    const [planned] = await occurrencesToday(behavior.id);
    const read = await readOperationHandlers.get_occurrence({ ...mcp, now: new Date() }, { occurrence_id: planned!.id });
    if (!read.ok) throw new Error("get_occurrence failed");
    const moved = await call("move_occurrence_for_day", {
      occurrence_id: planned!.id, start_time: "16:00", expected_revision: read.value.occurrence.revision,
    });
    expect(moved.outcome).toBe("moved");

    const proposalId = await propose(behavior.id, "15:00", "17:00");
    const result = await answerScheduleProposal(caller(), { proposalId, answer: "try" });
    expect(result.applied).toBe(true);
    const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 });
    const tomorrowLabel = tomorrow.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });
    expect(result.message).toBe(`Gym is at 5:00 PM every day from ${tomorrowLabel}. Cadence asks on ${
      Temporal.PlainDate.from(today).add({ days: 14 }).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" })} whether to keep it.`);

    // One item today, the same one, still at the time it was moved to by hand.
    const after = await occurrencesToday(behavior.id);
    expect(after.map((row) => row.id)).toEqual([planned!.id]);
    expect(Temporal.Instant.from(after[0]!.effective_start_at!).toString()).toBe(localInstant("16:00"));
    const history = await admin.from("occurrence_moves").select("id").eq("occurrence_id", planned!.id);
    expect(history.data).toHaveLength(1);
  }, 60_000);
});
