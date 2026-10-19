import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBehavior } from "@cadence/core/services/behavior.service";
import { validateOperationOutput } from "@cadence/core/integration";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import { approveOAuthConsent, registerOAuthClient } from "@/lib/db/oauth.repo";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { parseIntegrationSigningKey } from "@/lib/supabase/integration-token";
import { readOperationHandlers, type ReadOperationName } from "@/lib/integrations/operations/read";
import type { Database } from "@/lib/db/database.types";

// Opt-in, disposable loopback database only. The service role creates users and registers the test client;
// every product-data setup/read and handler uses the internal user token under RLS.
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;

localDescribe("integration reads with two isolated accounts", () => {
  const users: string[] = [];
  const run = randomUUID();
  const clientId = `read-test-${run}`;
  let admin: ReturnType<typeof createClient<Database>>;
  let a: IntegrationContext;
  let b: IntegrationContext;
  let behaviorA: string;
  let behaviorB: string;
  let occurrenceA: string;
  let occurrenceB: string;
  let today: string;
  let beforeA: unknown;

  beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(url!).hostname)) throw new Error("Read isolation tests require loopback Supabase.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    await registerOAuthClient(admin, {
      clientId, registrationType: "dcr", clientName: "Read isolation test", clientUri: null, logoUri: null,
      redirectUris: ["https://example.test/callback"], applicationType: "web", metadata: {}, verifiedClient: null, metadataExpiresAt: null,
    });
    const key = parseIntegrationSigningKey(signingKey!);
    async function setup(label: string) {
      const user = await admin.auth.admin.createUser({ email: `read-${label}-${run}@example.test`, password: randomUUID(), email_confirm: true });
      if (user.error || !user.data.user) throw new Error("Could not create isolated test user.");
      const userId = user.data.user.id;
      users.push(userId);
      const makeContext = (grantId: string) => createIntegrationContext({ userId, grantId, clientId, clientLabel: "Test", channel: "mcp", scopes: ["cadence.read"] }, {
        now: new Date(), signingKey: key, runtimeConfig: { url: url!, publishableKey: publishableKey! },
      });
      const initial = makeContext(randomUUID());
      const consent = await approveOAuthConsent(initial.supabase, { clientId, redirectUri: "https://example.test/callback",
        codeChallenge: "a".repeat(43), codeHash: createHash("sha256").update(randomUUID()).digest("hex"), resource: "https://app.cadence-me.com/mcp", scopes: ["cadence.read"] });
      const context = makeContext(consent.grantId);
      const behavior = await createBehavior(createBehaviorStore(context.supabase, userId), {
        userId, timezone: "America/New_York", recordedAt: context.now.toISOString(),
        values: { title: `Read ${label}`, description: `Only ${label}`, categoryId: null,
          recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00", active: true,
          browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0,
          schedules: [{ id: null, recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
            timeEntries: [{ id: null, kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }] },
      });
      const history = await context.supabase.from("occurrences").insert({ user_id: userId, behavior_id: behavior.id,
        local_date: "2000-01-02", scheduled_for: "2000-01-02T14:00:00Z", schedule_kind: "exact", schedule_start_time: "09:00",
        status: "completed", completed_at: "2000-01-02T15:00:00Z", status_marked_at: "2000-01-02T15:00:00Z", note: `Private note ${label}`,
      }).select("id").single();
      if (history.error) throw history.error;
      return { context, behaviorId: behavior.id, occurrenceId: history.data!.id };
    }
    const first = await setup("A"); a = first.context; behaviorA = first.behaviorId; occurrenceA = first.occurrenceId;
    const second = await setup("B"); b = second.context; behaviorB = second.behaviorId; occurrenceB = second.occurrenceId;
    today = Temporal.Instant.from(a.now.toISOString()).toZonedDateTimeISO("America/New_York").toPlainDate().toString();
    beforeA = (await a.supabase.from("behaviors").select("*").eq("id", behaviorA).single()).data;
  }, 60_000);

  afterAll(async () => {
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error("Could not remove isolated test user.");
    }
  });

  it("every read validates and excludes user B's identifiers and note text", async () => {
    const inputs: Record<ReadOperationName, unknown> = {
      get_account_context: {}, list_behaviors: {}, get_behavior: { behavior_id: behaviorA }, list_categories: {},
      get_timeline: {}, list_occurrences: { start_local_date: today, end_local_date: today }, get_occurrence: { occurrence_id: occurrenceA },
      get_adherence_summary: { start_local_date: "2000-01-01", end_local_date: "2000-01-03" },
      search: { query: "Private note" }, fetch: { id: `occurrence:${occurrenceA}` },
    };
    for (const name of Object.keys(inputs) as ReadOperationName[]) {
      const result = await readOperationHandlers[name](a, inputs[name]);
      expect(result.ok, `${name}: ${JSON.stringify(result)}`).toBe(true);
      if (result.ok) expect(validateOperationOutput(name, result.value).ok).toBe(true);
      const serialized = JSON.stringify(result);
      for (const privateValue of [b.userId, behaviorB, occurrenceB, "Private note B"]) expect(serialized).not.toContain(privateValue);
    }
    const after = await a.supabase.from("behaviors").select("*").eq("id", behaviorA).single();
    expect(after.data).toEqual(beforeA);
    const history = await a.supabase.from("occurrences").select("status,note").eq("id", occurrenceA).single();
    expect(history.data).toEqual({ status: "completed", note: "Private note A" });
  }, 60_000);

  it("refuses direct reads and fetches for the other account", async () => {
    for (const [name, input] of [
      ["get_behavior", { behavior_id: behaviorB }], ["get_occurrence", { occurrence_id: occurrenceB }],
      ["fetch", { id: `behavior:${behaviorB}` }], ["fetch", { id: `occurrence:${occurrenceB}` }],
    ] as const) expect(await readOperationHandlers[name](a, input)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await readOperationHandlers.list_behaviors(a, { category_id: randomUUID() })).toMatchObject({ ok: true, value: { behaviors: [] } });
  });

  it("keeps pairwise references client-specific and both accounts readable", async () => {
    const own = await readOperationHandlers.get_behavior(b, { behavior_id: behaviorB });
    expect(own).toMatchObject({ ok: true, value: { behavior: { id: behaviorB } } });
    const accountA = await readOperationHandlers.get_account_context(a, {});
    const accountB = await readOperationHandlers.get_account_context(b, {});
    expect(accountA.ok && accountB.ok).toBe(true);
    if (accountA.ok && accountB.ok) expect(accountA.value.account_ref).not.toBe(accountB.value.account_ref);
  });
});
