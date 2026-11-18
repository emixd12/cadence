import { randomUUID, sign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/database.types";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { createAgentContext } from "@/lib/integrations/agent-caller";
import { parseIntegrationSigningKey, type IntegrationSigningKey } from "@/lib/supabase/integration-token";
import { registerOAuthClient, approveOAuthConsent } from "@/lib/db/oauth.repo";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import { readBriefMoveDay } from "@/lib/services/brief-move-day.service";
import {
  BriefMoveError,
  answerBriefMove,
  ensureBehaviorEstimates,
  planBriefMoveLines,
  readBehaviorMovePreference,
  readBriefMoves,
  replanBriefMove,
  saveBriefProposals,
  setBriefMoveLength,
  type BriefMoveCallers,
} from "@/lib/services/brief-moves.service";
import { NO_TRAVEL_CONCLUSIONS_SECRETS } from "@/lib/services/travel-conclusions-token";
import type { BriefMoveLine } from "@cadence/core/types/brief-moves";

// Advisor Phase 3A1 against an isolated local Supabase: the brief plans lines with the
// one free-slot rule, saves them as proposals, and every answer (Yes, Undo, Re-plan,
// Accept all, Undo all, Other time, Already did it, Don't suggest) changes the record
// the way the plan says, with one answer row each.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;

/** An Etc/GMT zone where the local time is between 10:00 and 11:00. */
function morningZone(now: Temporal.Instant): string {
  const utcHour = now.toZonedDateTimeISO("UTC").hour;
  let offset = 10 - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

/** A person's own session token, as Supabase Auth would issue it. */
function personToken(key: IntegrationSigningKey, userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "ES256", typ: "JWT", kid: key.kid })}.${encode({
    sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 900, session_id: randomUUID(),
  })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

localDescribe("Daily Brief move lines on isolated local Supabase (advisor Phase 3A1)", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let mcp: IntegrationContext;
  let person: AppSupabaseClient;
  let agent: AppSupabaseClient;
  let userId: string;
  let timezone: string;
  let today: string;
  const clientId = `dcr-brief-3a1-${randomUUID()}`;
  const local = (time: string) => Temporal.PlainDate.from(today).toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(timezone).toInstant();
  const behavior = async (title: string, start: string, minutes: number | null) => {
    const result = await writeOperationHandlers.create_behavior({ ...mcp, now: new Date() }, {
      title, ...(minutes ? { default_duration_minutes: minutes } : {}),
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: start }] }],
    });
    if (!result.ok) throw new Error(`create_behavior failed: ${JSON.stringify(result.error)}`);
    return (result.value as { behavior: { id: string } }).behavior.id;
  };
  const callers = (): BriefMoveCallers => ({
    person: { supabase: person, userId, now: Temporal.Now.instant() },
    agent: async () => agent,
    travelSecrets: NO_TRAVEL_CONCLUSIONS_SECRETS,
  });
  const occurrence = async (id: string) => {
    const { data, error } = await admin.from("occurrences").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  };
  const answers = async (proposalId: string) => {
    const { data, error } = await admin.from("move_proposal_answers").select("kind, outcome, source, batch_id").eq("proposal_id", proposalId).order("created_at");
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local writes require loopback.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = Temporal.Now.instant();
    timezone = morningZone(now);
    today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "Brief test", clientUri: null,
      logoUri: null, redirectUris: ["https://client.example/callback"], applicationType: "web", metadata: {},
      verifiedClient: null, metadataExpiresAt: null });
    const created = await admin.auth.admin.createUser({ email: `brief-${randomUUID()}@example.test`, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create local fixture user.");
    userId = created.data.user.id;
    const profile = await admin.from("profiles").update({ timezone }).eq("id", userId);
    if (profile.error) throw profile.error;
    const key = parseIntegrationSigningKey(signingKey!);
    const options = { now: new Date(), signingKey: key, runtimeConfig: { url: url!, publishableKey: publishableKey! } };
    const grant = { userId, grantId: randomUUID(), clientId, clientLabel: "Brief test", channel: "mcp" as const,
      scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] as const };
    const consent = await approveOAuthConsent(createIntegrationContext(grant, options).supabase, { clientId,
      redirectUri: "https://client.example/callback", codeChallenge: "a".repeat(43), resource: "https://app.cadence-me.com/mcp",
      scopes: [...grant.scopes], codeHash: randomUUID().replaceAll("-", "").repeat(2) });
    mcp = createIntegrationContext({ ...grant, grantId: consent.grantId }, options);
    agent = (await createAgentContext(userId, "daily_brief", { signingKey: key, runtimeConfig: options.runtimeConfig })).supabase;
    const token = personToken(key, userId);
    person = createClient<Database>(url!, publishableKey!, { accessToken: async () => token, auth: { persistSession: false } }) as unknown as AppSupabaseClient;
  }, 30_000);

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("plans, saves and answers move lines, each answer recorded once", async () => {
    await behavior("Gym", "14:00", 60);
    const readId = await behavior("Read", "14:30", 30);
    const walkId = await behavior("Walk", "16:00", 30);
    const stretchId = await behavior("Stretch", "18:00", null);
    const teaId = await behavior("Tea", "15:15", 15);
    const journalId = await behavior("Journal", "19:00", 20);
    const napId = await behavior("Nap", "20:30", 30);
    const calendarBusy = [
      { startAt: local("16:00").toString(), endAt: local("17:00").toString(), title: "Team sync" },
      { startAt: local("18:00").toString(), endAt: local("18:30").toString() },
      { startAt: local("15:15").toString(), endAt: local("15:30").toString() },
      { startAt: local("19:00").toString(), endAt: local("19:30").toString() },
      { startAt: local("20:30").toString(), endAt: local("21:00").toString() },
    ];

    // Every Behavior's estimate is missing at first; Stretch has no length of its own.
    let day = await readBriefMoveDay(person, userId, today);
    expect(day.staleEstimateBehaviorIds.has(stretchId)).toBe(true);
    const asked: string[] = [];
    day = await ensureBehaviorEstimates({ agent, userId, localDate: today, day, model: "test-model",
      estimate: async (behaviors) => behaviors.map((item) => { asked.push(item.title); return { behaviorId: item.id, minutes: item.id === stretchId ? 25 : null, alongside: false }; }) });
    expect(asked).toContain("Stretch");
    expect(day.staleEstimateBehaviorIds.size).toBe(0);
    expect(day.items.find((item) => item.behaviorId === stretchId)!.length).toEqual({ minutes: 25, source: "model_estimate", assumed: true });

    const plan = await planBriefMoveLines({ supabase: person, userId, localDate: today, timezone, now: Temporal.Now.instant(),
      context: null, planning: { calendarBusy }, travelSecrets: NO_TRAVEL_CONCLUSIONS_SECRETS, day });
    const byBehavior = new Map(plan.candidates.map((candidate) => [candidate.behaviorId, candidate]));
    expect([...byBehavior.keys()].sort()).toEqual([readId, walkId, stretchId, teaId, journalId, napId].sort());
    expect(byBehavior.get(readId)!.reasonCode).toBe("item_overlap");
    expect(byBehavior.get(walkId)).toMatchObject({ reasonCode: "calendar_overlap", anchor: { kind: "calendar_event", title: "Team sync" }, calendarDerived: true });

    const saved = await saveBriefProposals(agent, { runId: null, localDate: today, refresh: false, candidates: plan.candidates });
    expect(saved).toHaveLength(6);
    const line = (behaviorId: string, lines: readonly BriefMoveLine[] = saved) => lines.find((item) => item.behaviorId === behaviorId)!;
    const shown = await readBriefMoves(person, { userId, localDate: today, timezone });
    expect(shown.lines).toHaveLength(6);
    expect(shown.acceptAll).toBe(true);

    // Yes moves the item through the brief's own channel, with the shown length.
    const walk = line(walkId);
    const yes = await answerBriefMove(callers(), { kind: "yes", proposalId: walk.proposalId, expectedRevision: walk.expectedRevision,
      context: { calendarBusy }, idempotencyKey: "yes-walk" });
    expect(yes).toMatchObject({ kind: "yes", replayed: false, showFirstMoveLine: true, results: [{ outcome: "applied", line: { status: "accepted" } }] });
    const moved = await occurrence(walk.occurrenceId);
    expect(Temporal.Instant.from(moved.effective_start_at!).toString()).toBe(walk.to.startAt);
    const move = await admin.from("occurrence_moves").select("source, duration_source, proposal_id").eq("id", yes.results[0]!.moveId!).single();
    expect(move.data).toEqual({ source: "daily_brief", duration_source: "behavior_duration", proposal_id: walk.proposalId });
    // The same tap again changes nothing.
    const again = await answerBriefMove(callers(), { kind: "yes", proposalId: walk.proposalId, expectedRevision: walk.expectedRevision,
      context: { calendarBusy }, idempotencyKey: "yes-walk" });
    expect(again.replayed).toBe(true);
    expect(await answers(walk.proposalId)).toEqual([{ kind: "yes", outcome: "applied", source: "person", batch_id: null }]);

    // Undo puts it back and counts as No for the day.
    const undo = await answerBriefMove(callers(), { kind: "undo", proposalId: walk.proposalId, expectedRevision: moved.updated_at, idempotencyKey: "undo-walk" });
    expect(undo.results[0]).toMatchObject({ outcome: "applied", line: { status: "undone" } });
    const back = await occurrence(walk.occurrenceId);
    expect(Temporal.Instant.from(back.effective_start_at ?? back.scheduled_for).toString()).toBe(local("16:00").toString());

    // Re-plan offers another time and replaces the line.
    const read = line(readId);
    const replanned = await replanBriefMove(callers(), { proposalId: read.proposalId, context: { calendarBusy } });
    expect(replanned.replacedProposalId).toBe(read.proposalId);
    expect(replanned.line!.to.startAt).not.toBe(read.to.startAt);
    expect((await admin.from("move_proposals").select("status").eq("id", read.proposalId).single()).data!.status).toBe("superseded");

    // Accept all checks each line on its own; Undo all reverses that batch.
    const stretch = line(stretchId);
    const all = await answerBriefMove(callers(), { kind: "accept_all", idempotencyKey: "all-1", context: { calendarBusy },
      lines: [{ proposalId: replanned.line!.proposalId, expectedRevision: replanned.line!.expectedRevision },
        { proposalId: stretch.proposalId, expectedRevision: stretch.expectedRevision }] });
    expect(all.results.map((result) => result.outcome)).toEqual(["applied", "applied"]);
    expect(all.batchId).toMatch(/^[0-9a-f-]{36}$/);
    const stretchMove = await admin.from("occurrence_moves").select("duration_source, to_start_at, to_end_at").eq("id", all.results[1]!.moveId!).single();
    expect(stretchMove.data!.duration_source).toBe("model_estimate");
    expect((await readBriefMoves(person, { userId, localDate: today, timezone })).undoAllBatchId).toBe(all.batchId);
    const undoAll = await answerBriefMove(callers(), { kind: "undo_all", batchId: all.batchId!, idempotencyKey: "undo-all-1" });
    expect(undoAll.results.map((result) => result.line?.status)).toEqual(["undone", "undone"]);
    expect((await answers(stretch.proposalId)).map((row) => row.kind)).toEqual(["accept_all", "undo_all"]);

    // Other time: a move to one of the line's other times, then status other_time.
    const tea = line(teaId);
    const other = await answerBriefMove(callers(), { kind: "other_time", proposalId: tea.proposalId, expectedRevision: tea.expectedRevision,
      startAt: tea.otherTimes[0]!, context: { calendarBusy }, idempotencyKey: "other-tea" });
    expect(other.results[0]).toMatchObject({ outcome: "applied", line: { status: "other_time" } });
    expect(Temporal.Instant.from((await occurrence(tea.occurrenceId)).effective_start_at!).toString()).toBe(tea.otherTimes[0]);

    // Already did it: recorded, then the item is Completed.
    const journal = line(journalId);
    const done = await answerBriefMove(callers(), { kind: "already_done", proposalId: journal.proposalId, expectedRevision: journal.expectedRevision, idempotencyKey: "done-journal" });
    expect(done.results[0]).toMatchObject({ outcome: "applied", line: { status: "already_done" }, occurrence: { status: "completed" } });

    // Don't suggest moving this: the switch is on and the line closes.
    const nap = line(napId);
    const never = await answerBriefMove(callers(), { kind: "never_move", proposalId: nap.proposalId, idempotencyKey: "never-nap" });
    expect(never.results[0]!.line!.status).toBe("declined");
    expect(await readBehaviorMovePreference(callers().person, napId)).toMatchObject({ neverSuggestMove: true });

    // A closed line refuses a second answer.
    await expect(answerBriefMove(callers(), { kind: "no", proposalId: nap.proposalId, idempotencyKey: "no-nap" }))
      .rejects.toMatchObject({ code: "proposal_closed" } satisfies Partial<BriefMoveError>);

    // After all that, nothing answered today is offered again. Read was undone, so its
    // overlap with Gym is now offered as a move of Gym instead.
    const later = await planBriefMoveLines({ supabase: person, userId, localDate: today, timezone, now: Temporal.Now.instant(),
      context: null, planning: { calendarBusy }, travelSecrets: NO_TRAVEL_CONCLUSIONS_SECRETS });
    expect(later.candidates.map((candidate) => `${candidate.title} ${candidate.reasonCode}`)).toEqual(["Gym item_overlap"]);

    // The person's own length replaces the estimate.
    const stretchBehavior = await admin.from("behaviors").select("updated_at").eq("id", stretchId).single();
    await expect(setBriefMoveLength(callers().person, { behaviorId: stretchId, minutes: 40, expectedBehaviorRevision: "2020-01-01T00:00:00Z" }))
      .rejects.toMatchObject({ code: "revision_changed" });
    const length = await setBriefMoveLength(callers().person, { behaviorId: stretchId, minutes: 40, expectedBehaviorRevision: stretchBehavior.data!.updated_at });
    expect(length.minutes).toBe(40);
    const estimate = await admin.from("behavior_advisor_estimates").select("behavior_id").eq("behavior_id", stretchId);
    expect(estimate.data).toEqual([]);
  }, 90_000);
});
