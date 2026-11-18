import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAgentRun } from "@/lib/db/agent-runs.repo";
import type { Database } from "@/lib/db/database.types";
import { createAgentClient } from "@/lib/integrations/agent-caller";
import {
  createHostedCoachVisitPort,
  hostedDueCoachAccounts,
  visitCoachAccount,
} from "@/lib/services/coach-signals-job.service";
import { parseIntegrationSigningKey, type IntegrationSigningKey } from "@/lib/supabase/integration-token";

// Opt-in, advisor plan Phase 3 workstream 3D. Same isolated local project and variables
// as tests/agent-caller.local-integration.test.ts (docs/SUPABASE_WORKFLOW.md,
// "Integration request tokens"), including CADENCE_LOCAL_SUPABASE_DB_URL for seeding
// history with psql. Refuses non-loopback URLs. Checks:
//   - only active accounts in their early morning are due, and a finished visit is not due again;
//   - a visit stores the signals as the person, on the coach token, and a re-run replaces them;
//   - only the coach token can store signals, only into its own run, and only the
//     service role can list due accounts.

const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localSigningKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const enabled = Boolean(localUrl && localServiceKey && localPublishableKey && localSigningKey && process.env.CADENCE_LOCAL_SUPABASE_DB_URL);
const localDescribe = enabled ? describe : describe.skip;

/** An Etc/GMT zone where the local hour is `hour` now (whole-hour offsets only). */
function zoneAtHour(now: Temporal.Instant, hour: number): string {
  let offset = hour - now.toZonedDateTimeISO("UTC").hour;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

function sql(statement: string): string {
  return execFileSync("psql", [process.env.CADENCE_LOCAL_SUPABASE_DB_URL!, "-XqAt", "-v", "ON_ERROR_STOP=1"], {
    input: statement, encoding: "utf8",
  }).trim();
}

localDescribe("coach signals in shadow against local Supabase (advisor 3D)", () => {
  let admin: SupabaseClient<Database>;
  let signingKey: IntegrationSigningKey;
  let active: string;
  let inactive: string;
  let notMorning: string;
  let morningZone: string;
  let today: string;
  const runId = randomUUID().slice(0, 8);
  const options = () => ({ signingKey, runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! } });
  const ours = (ids: readonly string[]) => ids.filter((id) => [active, inactive, notMorning].includes(id));

  async function createUser(label: string, timezone: string): Promise<string> {
    const created = await admin.auth.admin.createUser({ email: `coach-${label}-${runId}@example.test`, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create local fixture user.");
    const profile = await admin.from("profiles").update({ timezone }).eq("id", created.data.user.id);
    if (profile.error) throw profile.error;
    return created.data.user.id;
  }

  /** One Behavior with a completion drop, a brief decline yesterday, and a mark made just now. */
  function seedHistory(userId: string, timezone: string) {
    const behaviorId = randomUUID();
    const day = (offset: number) => Temporal.PlainDate.from(today).add({ days: offset }).toString();
    const statuses = [
      ...Array.from({ length: 12 }, (_, index) => [day(-42 + index), index < 10 ? "completed" : "not_completed"]),
      ...Array.from({ length: 6 }, (_, index) => [day(-6 + index), index < 3 ? "completed" : "not_completed"]),
    ];
    const occurrenceRows = statuses.map(([localDate, status]) =>
      `('${userId}', '${behaviorId}', '${localDate} 09:00:00 ${timezone}', '${localDate}', '09:00', '${status}')`).join(",\n");
    sql(`
      set session_replication_role = replica;
      insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, created_at)
      values ('${behaviorId}', '${userId}', 'Reading', '{"frequency":"daily","interval":1}', '09:00', '${timezone}', now() - interval '90 days');
      insert into public.occurrences (user_id, behavior_id, scheduled_for, local_date, schedule_start_time, status)
      values ${occurrenceRows};
      insert into public.occurrence_status_events (user_id, occurrence_id, behavior_id, status, status_semantics, recorded_at, local_date, timezone)
      select user_id, id, behavior_id, status, 'explicit_user_mark', now(), local_date, '${timezone}'
      from public.occurrences where user_id = '${userId}' and local_date = '${day(-1)}';
      insert into public.move_proposals (user_id, occurrence_id, behavior_id, local_date, source, status,
        proposed_start_at, proposed_end_at, expected_revision, status_changed_at)
      select user_id, id, behavior_id, local_date, 'daily_brief', 'declined',
        scheduled_for + interval '2 hours', scheduled_for + interval '150 minutes', updated_at, now()
      from public.occurrences where user_id = '${userId}' and local_date = '${day(-1)}';
    `);
    return behaviorId;
  }

  const storedSignals = (userId: string) => sql(`
    select kind || ':' || coalesce(behavior_id::text, 'account')
    from cadence_advisor_private.coach_signals where user_id = '${userId}' order by kind, behavior_id nulls last;
  `).split("\n").filter(Boolean);

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("The coach signal test only runs against loopback Supabase.");
    signingKey = parseIntegrationSigningKey(localSigningKey!);
    admin = createClient<Database>(localUrl!, localServiceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = Temporal.Now.instant();
    morningZone = zoneAtHour(now, 4);
    today = now.toZonedDateTimeISO(morningZone).toPlainDate().toString();
    active = await createUser("active", morningZone);
    inactive = await createUser("inactive", morningZone);
    notMorning = await createUser("noon", zoneAtHour(now, 12));
    seedHistory(active, morningZone);
    // The other two have only old marks, or a fresh mark outside their early morning.
    seedHistory(inactive, morningZone);
    sql(`update public.occurrence_status_events set recorded_at = now() - interval '9 days' where user_id = '${inactive}';`);
    seedHistory(notMorning, zoneAtHour(now, 12));
  }, 60_000);

  afterAll(async () => {
    for (const id of [active, inactive, notMorning]) if (id) await admin?.auth.admin.deleteUser(id);
  });

  it("selects only active accounts in their early morning, and stores signals as the person", async () => {
    const due = hostedDueCoachAccounts(admin);
    const first = await due({ after: null, limit: 500 });
    expect(ours(first.map((account) => account.userId))).toEqual([active]);
    expect(first.find((account) => account.userId === active)?.localDate).toBe(today);

    const outcome = await visitCoachAccount(createHostedCoachVisitPort(active, options()));
    expect(outcome).toEqual({ signals: 3, answersSource: expect.stringMatching(/^(answers|proposals)$/) });
    const behaviorId = sql(`select id from public.behaviors where user_id = '${active}'`);
    expect(storedSignals(active)).toEqual([
      `brief_answers:${behaviorId}`, "brief_answers:account", `completion_drop:${behaviorId}`,
    ]);
    expect(sql(`select facts::text from cadence_advisor_private.coach_signals
                where user_id = '${active}' and kind = 'completion_drop'`)).toContain('"recent_rate": 0.5');
    expect(sql(`select agent || ':' || trigger || ':' || outcome || ':' || model_calls || ':' || local_date
                from cadence_advisor_private.agent_runs where user_id = '${active}'`)).toBe(`coach:scheduled:success:0:${today}`);

    // Done for today: not due again. A forced re-run replaces the day's signals.
    expect(ours((await due({ after: null, limit: 500 })).map((account) => account.userId))).toEqual([]);
    await visitCoachAccount(createHostedCoachVisitPort(active, options()));
    expect(storedSignals(active)).toHaveLength(3);
  });

  it("walks accounts by cursor", async () => {
    sql(`delete from cadence_advisor_private.agent_runs where user_id = '${active}';`);
    const due = hostedDueCoachAccounts(admin);
    const all = (await due({ after: null, limit: 500 })).map((account) => account.userId);
    const index = all.indexOf(active);
    expect(index).toBeGreaterThanOrEqual(0);
    const after = index === 0 ? null : all[index - 1]!;
    expect((await due({ after, limit: 1 })).map((account) => account.userId)).toEqual([active]);
    expect((await due({ after: active, limit: 500 })).map((account) => account.userId)).not.toContain(active);
  });

  it("lets only the coach token store signals, only into its own run", async () => {
    const coach = createAgentClient(active, "coach", options()).client;
    const run = await startAgentRun(coach, { trigger: "scheduled", model: null, promptVersion: "coach-signals-1" });
    const signals = [{ kind: "late_marking", behavior_id: null, facts: { decisions: 10 } }];

    const brief = createAgentClient(active, "daily_brief", options()).client;
    const byBrief = await brief.rpc("coach_record_signals", { p_run_id: run.runId, p_signal_version: "coach-signals-1", p_signals: signals });
    expect(byBrief.error?.message).toBe("agent_channel_required");

    const otherCoach = createAgentClient(inactive, "coach", options()).client;
    const byOther = await otherCoach.rpc("coach_record_signals", { p_run_id: run.runId, p_signal_version: "coach-signals-1", p_signals: signals });
    expect(byOther.error?.message).toBe("agent_run_not_found");

    const byService = await admin.rpc("coach_record_signals", { p_run_id: run.runId, p_signal_version: "coach-signals-1", p_signals: signals });
    expect(byService.error).not.toBeNull();

    const listByCoach = await coach.rpc("coach_due_accounts", { p_after: null as unknown as string, p_limit: 10 });
    expect(listByCoach.error).not.toBeNull();

    // The table is closed to every API role.
    const direct = await coach.schema("cadence_advisor_private" as never).from("coach_signals").select("id");
    expect(direct.data ?? []).toEqual([]);

    const own = await coach.rpc("coach_record_signals", { p_run_id: run.runId, p_signal_version: "coach-signals-1", p_signals: signals });
    expect(own).toMatchObject({ error: null, data: 1 });
  });
});
