import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBehavior as createCoreBehavior } from "../packages/core/src/services/behavior.service";
import { createBehaviorStore } from "../lib/db/behavior-store";
import type { Database } from "../lib/db/database.types";
import {
  createIntegrationContext,
  type IntegrationContext,
} from "../lib/integrations/request-context";
import {
  mintIntegrationAccessToken,
  parseIntegrationSigningKey,
  type IntegrationSigningKey,
} from "../lib/supabase/integration-token";

// Opt-in. Requires an isolated local Supabase project whose Auth config loads
// the same private key through `signing_keys_path`. See
// docs/SUPABASE_WORKFLOW.md "Integration request tokens".
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localSigningKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const enabled = Boolean(
  localUrl && localServiceKey && localPublishableKey && localSigningKey,
);
const localDescribe = enabled ? describe : describe.skip;

type AdminClient = SupabaseClient<Database>;
type TestUser = { id: string; categoryId: string };

localDescribe("integration request context against local Supabase RLS", () => {
  let admin: AdminClient;
  let signingKey: IntegrationSigningKey;
  let userA: TestUser;
  let userB: TestUser;
  let contextA: IntegrationContext;
  let contextB: IntegrationContext;
  let behaviorA: string;
  let behaviorB: string;
  let occurrenceA: string;
  let occurrenceB: string;
  const createdUserIds: string[] = [];
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("The integration RLS test only runs against loopback Supabase.");
    }

    signingKey = parseIntegrationSigningKey(localSigningKey!);
    // The service-role client only creates and deletes test users. The
    // context path under test never receives it.
    admin = createClient<Database>(localUrl!, localServiceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const idA = await createUser(admin, `integration-a-${runId}@example.test`);
    createdUserIds.push(idA);
    const idB = await createUser(admin, `integration-b-${runId}@example.test`);
    createdUserIds.push(idB);

    contextA = contextFor(idA, signingKey);
    contextB = contextFor(idB, signingKey);
    userA = { id: idA, categoryId: await waitForDefaultCategory(contextA) };
    userB = { id: idB, categoryId: await waitForDefaultCategory(contextB) };

    behaviorA = await createBehavior(contextA, userA, "Integration A");
    behaviorB = await createBehavior(contextB, userB, "Integration B");
    occurrenceA = await createOccurrence(contextA, userA.id, behaviorA);
    occurrenceB = await createOccurrence(contextB, userB.id, behaviorB);
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin?.auth.admin.deleteUser(id);
    }
  });

  it("reads the grant user's own rows", async () => {
    const supabase = contextA.supabase;
    const profile = await supabase.from("profiles").select("id").eq("id", userA.id);
    const behaviors = await supabase.from("behaviors").select("id, user_id");
    const occurrences = await supabase.from("occurrences").select("id, user_id");

    expect(profile.error).toBeNull();
    expect(profile.data).toEqual([{ id: userA.id }]);
    expect(behaviors.error).toBeNull();
    expect(behaviors.data).toEqual([{ id: behaviorA, user_id: userA.id }]);
    expect(occurrences.error).toBeNull();
    expect(occurrences.data).toEqual([{ id: occurrenceA, user_id: userA.id }]);
  });

  it("cannot read another user's rows", async () => {
    const supabase = contextA.supabase;
    const profile = await supabase.from("profiles").select("id").eq("id", userB.id);
    const behavior = await supabase.from("behaviors").select("id").eq("id", behaviorB);
    const occurrence = await supabase
      .from("occurrences")
      .select("id")
      .eq("id", occurrenceB);
    const categories = await supabase
      .from("categories")
      .select("id")
      .eq("user_id", userB.id);

    expect(profile.data).toEqual([]);
    expect(behavior.data).toEqual([]);
    expect(occurrence.data).toEqual([]);
    expect(categories.data).toEqual([]);
  });

  it("cannot write another user's rows", async () => {
    const supabase = contextA.supabase;
    const update = await supabase
      .from("occurrences")
      .update({ note: "cross-account write" })
      .eq("id", occurrenceB)
      .select("id");
    const profileUpdate = await supabase
      .from("profiles")
      .update({ timezone: "UTC" })
      .eq("id", userB.id)
      .select("id");
    const categoryInsert = await supabase
      .from("categories")
      .insert({ user_id: userB.id, name: `Cross ${runId}` })
      .select("id");
    const occurrenceInsert = await supabase
      .from("occurrences")
      .insert(occurrenceRow(userB.id, behaviorB, "2000-01-03"))
      .select("id");

    expect(update.data ?? []).toEqual([]);
    expect(profileUpdate.data ?? []).toEqual([]);
    expect(categoryInsert.error).not.toBeNull();
    expect(occurrenceInsert.error).not.toBeNull();

    const ownerView = await contextB.supabase
      .from("occurrences")
      .select("note")
      .eq("id", occurrenceB)
      .single();
    const ownerProfile = await contextB.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userB.id)
      .single();
    expect(ownerView.data?.note).toBeNull();
    expect(ownerProfile.data?.timezone).not.toBe("UTC");
  });

  it("rejects an expired minted token", async () => {
    const expired = mintIntegrationAccessToken(signingKey, {
      userId: userA.id,
      channel: "mcp",
      grantId: "grant-expired",
      clientId: "client-expired",
      now: new Date(Date.now() - 10 * 60 * 1000),
    });
    const response = await fetch(
      `${localUrl}/rest/v1/profiles?select=id&id=eq.${userA.id}`,
      {
        headers: {
          apikey: localPublishableKey!,
          Authorization: `Bearer ${expired.token}`,
        },
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects a token signed by a key Supabase does not trust", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const untrusted = parseIntegrationSigningKey(
      JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: signingKey.kid }),
    );
    const context = contextFor(userA.id, untrusted);
    const result = await context.supabase.from("profiles").select("id");

    expect(result.error).not.toBeNull();
    expect(result.data).toBeNull();
  });
});

function contextFor(userId: string, key: IntegrationSigningKey): IntegrationContext {
  return createIntegrationContext(
    {
      userId,
      grantId: `grant-${userId}`,
      clientId: "local-test-client",
      clientLabel: "Local test",
      channel: "mcp",
      scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"],
    },
    {
      now: new Date(),
      signingKey: key,
      runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! },
    },
  );
}

async function createUser(admin: AdminClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Integration-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Unable to create local test user: ${error?.message}`);
  }
  return data.user.id;
}

async function waitForDefaultCategory(context: IntegrationContext): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await context.supabase
      .from("categories")
      .select("id")
      .eq("user_id", context.userId)
      .limit(1);
    if (data?.[0]) {
      return data[0].id;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for default categories.");
}

async function createBehavior(
  context: IntegrationContext,
  user: TestUser,
  title: string,
): Promise<string> {
  // Existing core service plus the existing web store, unchanged.
  const behavior = await createCoreBehavior(
    createBehaviorStore(context.supabase, context.userId),
    {
      userId: context.userId,
      timezone: "America/New_York",
      recordedAt: context.now.toISOString(),
      values: {
        title,
        description: null,
        categoryId: user.categoryId,
        recurrenceRule: { frequency: "daily", interval: 1 },
        scheduledTime: "09:00",
        browserReminderEnabled: true,
        emailReminderEnabled: false,
        reminderOffsetMinutes: 0,
        active: true,
        schedules: [
          {
            id: null,
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: null,
                kind: "exact",
                preset: null,
                startTime: "09:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    },
  );
  return behavior.id;
}

function occurrenceRow(userId: string, behaviorId: string, localDate: string) {
  return {
    user_id: userId,
    behavior_id: behaviorId,
    behavior_schedule_slot_id: null,
    scheduled_for: `${localDate}T14:00:00Z`,
    local_date: localDate,
    schedule_kind: "exact",
    schedule_preset: null,
    schedule_start_time: "09:00:00",
    schedule_end_time: null,
    status: "unresolved" as const,
    completed_at: null,
    status_marked_at: null,
    note: null,
  };
}

async function createOccurrence(
  context: IntegrationContext,
  userId: string,
  behaviorId: string,
): Promise<string> {
  const { data, error } = await context.supabase
    .from("occurrences")
    .insert(occurrenceRow(userId, behaviorId, "2000-01-02"))
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Unable to create local test occurrence: ${error?.message}`);
  }
  return data.id;
}
