import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

const ENV_FILE = ".env.local";
const PASSWORD_PREFIX = "CadenceRlsSmoke";
const DEFAULT_CATEGORY_NAME = "Other";
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const PUBLIC_DATA_API_RELATIONS = [
  { table: "profiles", ownerColumn: "id" },
  { table: "categories", ownerColumn: "user_id" },
  { table: "behaviors", ownerColumn: "user_id" },
  { table: "behavior_definition_events", ownerColumn: "user_id" },
  { table: "behavior_configuration_events", ownerColumn: "user_id" },
  { table: "behavior_schedules", ownerColumn: "user_id" },
  { table: "behavior_schedule_slots", ownerColumn: "user_id" },
  { table: "occurrences", ownerColumn: "user_id" },
  { table: "reminder_deliveries", ownerColumn: "user_id" },
  { table: "push_subscriptions", ownerColumn: "user_id" },
  { table: "occurrence_status_events", ownerColumn: "user_id" },
  {
    table: "occurrence_sync_state",
    ownerColumn: "user_id",
    selectColumn: "user_id",
  },
  { table: "behaviorlog_import_runs", ownerColumn: "user_id" },
  { table: "behaviorlog_import_record_mappings", ownerColumn: "user_id" },
  { table: "imported_notes", ownerColumn: "user_id" },
  { table: "imported_interventions", ownerColumn: "user_id" },
  {
    table: "launch_rate_limits",
    ownerColumn: "user_id",
    selectColumn: "user_id",
  },
  { table: "occurrence_time_sessions", ownerColumn: "user_id" },
];

export const PUBLIC_AUTHENTICATED_FUNCTIONS = [
  "apply_behaviorlog_restore_with_configuration_events",
  "apply_occurrence_generation_plan",
  "apply_occurrence_status_transition",
  "bind_behaviorlog_restore_apply_payload",
  "consume_launch_rate_limit",
  "create_behavior_with_schedule_graph",
  "get_export_page_read_bundle",
  "list_my_occurrence_time_session_history",
  "list_my_occurrence_time_sessions",
  "mark_occurrence_sync_fresh_if_configuration_current",
  "update_behavior_with_schedule_graph",
  "update_profile_and_behavior_timezones_with_config_events",
];

export function readSmokeConfig(env = process.env, envFilePath = ENV_FILE) {
  const fileEnv = readEnvFile(envFilePath);
  const mergedEnv = { ...fileEnv, ...env };
  const url = normalizeEnvValue(mergedEnv.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey =
    normalizeEnvValue(mergedEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    normalizeEnvValue(mergedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = normalizeEnvValue(mergedEnv.SUPABASE_SERVICE_ROLE_KEY);
  const missing = [];

  if (!url) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!publishableKey) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  if (!serviceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Missing Supabase RLS smoke config: ${missing.join(", ")}.`);
  }

  return {
    url,
    publishableKey,
    serviceRoleKey,
  };
}

export function parseLocalSmokeConfig(output) {
  const values = {};

  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match) {
      values[match[1]] = parseEnvironmentValue(match[2].trim());
    }
  }

  const url = normalizeEnvValue(values.API_URL);
  const publishableKey =
    normalizeEnvValue(values.PUBLISHABLE_KEY) ??
    normalizeEnvValue(values.ANON_KEY);
  const serviceRoleKey = normalizeEnvValue(values.SERVICE_ROLE_KEY);

  if (!url || !isLoopbackUrl(url)) {
    throw new Error("Local Supabase status did not return a loopback API URL.");
  }

  if (!publishableKey || !serviceRoleKey) {
    throw new Error("Local Supabase status omitted required runtime keys.");
  }

  return { url, publishableKey, serviceRoleKey };
}

export function readLocalSmokeConfig() {
  const result = spawnSync(
    "npm",
    ["run", "--silent", "supabase", "--", "status", "-o", "env"],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error("Unable to read the project-local Supabase status.");
  }

  return parseLocalSmokeConfig(result.stdout);
}

export function buildSmokeUserEmail(runId, slot) {
  return `cadence-rls-smoke-${runId}-${slot}@example.invalid`;
}

export function buildSmokePassword(runId) {
  return `${PASSWORD_PREFIX}-${runId}-aA1!`;
}

export function summarizeSmokeResult(result) {
  return [
    `RLS smoke passed for run ${result.runId}.`,
    `Created ${result.createdUsers} temporary users.`,
    `Verified ${result.checkedAssertions} ownership checks.`,
    "Cleaned up temporary users.",
  ].join(" ");
}

export async function cleanupTemporaryUsers(admin, users) {
  const results = await Promise.allSettled(
    users.map((user) => admin.auth.admin.deleteUser(user.id)),
  );
  const failed = results.filter(
    (result) => result.status === "rejected" || result.value?.error,
  );
  if (failed.length > 0) {
    throw new Error(`RLS smoke cleanup failed for ${failed.length} temporary users.`);
  }
}

async function main() {
  const config = process.argv.includes("--local")
    ? readLocalSmokeConfig()
    : readSmokeConfig();
  const runId = randomUUID().slice(0, 8);
  const password = buildSmokePassword(runId);
  const admin = createSupabase(config.url, config.serviceRoleKey);
  const users = [];
  let summary;

  try {
    for (const slot of ["a", "b", "c"]) {
      users.push(
        await createTemporaryUser(
          admin,
          buildSmokeUserEmail(runId, slot),
          password,
        ),
      );
    }

    const userA = users[0];
    const userB = users[1];
    const userC = users[2];
    const clientA = await signInTemporaryUser(config, userA.email, password);
    const clientB = await signInTemporaryUser(config, userB.email, password);
    const clientC = await signInTemporaryUser(config, userC.email, password);
    const assertions = [];

    await waitForOnboardingRows(clientA, userA.id);
    await waitForOnboardingRows(clientB, userB.id);
    await waitForOnboardingRows(clientC, userC.id);

    assertions.push(
      await assertZeroBehaviorFreshnessRejectsConcurrentStateCreation({
        client: clientC,
        userId: userC.id,
      }),
    );

    const categoryA = await getCategory(clientA, userA.id);
    const categoryB = await getCategory(clientB, userB.id);
    const categoryC = await getCategory(clientC, userC.id);
    const behaviorC = await createSmokeBehavior(clientC, {
      userId: userC.id,
      categoryId: categoryC.id,
      title: `RLS smoke timezone ${runId}`,
    });
    assertions.push(
      ...(await assertSettingsTimezoneTransaction({
        client: clientC,
        userId: userC.id,
        behavior: behaviorC,
      })),
    );
    const behaviorA = await createSmokeBehavior(clientA, {
      userId: userA.id,
      categoryId: categoryA.id,
      title: `RLS smoke A ${runId}`,
    });
    const behaviorB = await createSmokeBehavior(clientB, {
      userId: userB.id,
      categoryId: categoryB.id,
      title: `RLS smoke B ${runId}`,
    });
    const behaviorA2 = await createSmokeBehavior(clientA, {
      userId: userA.id,
      categoryId: categoryA.id,
      title: `RLS smoke A2 ${runId}`,
    });
    const configurationEventA = await getBehaviorConfigurationEvent(
      clientA,
      behaviorA.id,
    );
    const configurationEventA2 = await getBehaviorConfigurationEvent(
      clientA,
      behaviorA2.id,
    );
    const configurationEventB = await getBehaviorConfigurationEvent(
      clientB,
      behaviorB.id,
    );
    await archiveSmokeBehavior(clientB, behaviorB);
    await archiveSmokeBehavior(clientA, behaviorA2);
    const occurrenceA = await createSmokeOccurrence(clientA, {
      userId: userA.id,
      behaviorId: behaviorA.id,
      localDate: "2000-01-01",
      scheduledFor: "2000-01-01T14:00:00Z",
    });
    const occurrenceB = await createSmokeOccurrence(clientB, {
      userId: userB.id,
      behaviorId: behaviorB.id,
      localDate: "2000-01-02",
      scheduledFor: "2000-01-02T15:00:00Z",
    });
    const timeSessionA = await createSmokeTimeSession(clientA, {
      userId: userA.id,
      behaviorId: behaviorA.id,
      occurrenceId: occurrenceA.id,
      startedAt: "2000-01-01T14:00:00Z",
      stoppedAt: "2000-01-01T14:05:00Z",
    });
    const timeSessionB = await createSmokeTimeSession(clientB, {
      userId: userB.id,
      behaviorId: behaviorB.id,
      occurrenceId: occurrenceB.id,
      startedAt: "2000-01-02T15:00:00Z",
      stoppedAt: "2000-01-02T15:05:00Z",
    });
    assertions.push(await assertProfileIsolation(clientA, userB.id));
    assertions.push(
      ...(await assertProfileWriteIntegrity({
        admin,
        client: clientA,
        user: userA,
        updatedEmail: buildSmokeUserEmail(runId, "a-updated"),
      })),
    );
    assertions.push(await assertCategoryIsolation(clientA, userB.id));
    assertions.push(await assertBehaviorIsolation(clientA, behaviorB.id));
    assertions.push(await assertBehaviorInsertCheck(clientA, userB.id));
    assertions.push(await assertBehaviorUpdateIsolation(clientA, behaviorB.id));
    assertions.push(await assertOwnBehaviorVisible(clientA, behaviorA.id));
    assertions.push(
      ...(await assertEveryExposedRelationRejectsCrossAccountAccess(
        clientA,
        userB.id,
      )),
    );
    assertions.push("configuration_event_own_select");
    assertions.push(
      await assertBehaviorConfigurationEventIsolation(clientA, behaviorB.id),
    );
    assertions.push(
      ...(await assertBehaviorConfigurationEventAppendOnly({
        client: clientA,
        userId: userA.id,
        behaviorId: behaviorA.id,
        eventId: configurationEventA.id,
      })),
    );
    assertions.push(
      ...(await assertOccurrenceConfigurationLineage({
        admin,
        client: clientA,
        userId: userA.id,
        behavior: behaviorA,
        secondBehavior: behaviorA2,
        occurrence: occurrenceA,
        currentEvent: configurationEventA,
        staleSecondEvent: configurationEventA2,
        foreignEvent: configurationEventB,
      })),
    );
    assertions.push(
      ...(await assertReminderDeliveryIntegrity({
        admin,
        client: clientA,
        userId: userA.id,
        occurrenceId: occurrenceA.id,
      })),
    );
    assertions.push(
      ...(await assertTimeSessionRpcIsolation({
        clientA,
        clientB,
        occurrenceA,
        occurrenceB,
        timeSessionA,
        timeSessionB,
      })),
    );
    assertions.push(
      ...(await assertAnonymousTimeSessionRpcDenial(config)),
    );

    summary = summarizeSmokeResult({
      runId,
      createdUsers: users.length,
      checkedAssertions: assertions.length,
    });
  } finally {
    await cleanupTemporaryUsers(admin, users);
  }
  console.log(summary);
}

async function assertEveryExposedRelationRejectsCrossAccountAccess(
  client,
  otherUserId,
) {
  const assertions = [];

  for (const { table, ownerColumn, selectColumn = "id" } of PUBLIC_DATA_API_RELATIONS) {
    const read = await client
      .from(table)
      .select(selectColumn)
      .eq(ownerColumn, otherUserId)
      .limit(1);
    assertNoError(read.error, `reading another account's ${table} rows`);
    assertNoRows(read.data, `another account's ${table} rows`);
    assertions.push(`${table}_cross_account_select`);

    const deletion = await client
      .from(table)
      .delete()
      .eq(ownerColumn, otherUserId)
      .select(selectColumn);
    if (!deletion.error) {
      assertNoRows(deletion.data, `deleted another account's ${table} rows`);
    }
    assertions.push(`${table}_cross_account_delete`);
  }

  return assertions;
}

async function createTemporaryUser(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: "Cadence RLS Smoke",
    },
  });

  if (error || !data.user) {
    throw new Error(`Unable to create temporary smoke user: ${error?.message}`);
  }

  return {
    id: data.user.id,
    email,
  };
}

async function signInTemporaryUser(config, email, password) {
  const client = createSupabase(config.url, config.publishableKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Unable to sign in temporary smoke user: ${error.message}`);
  }

  return client;
}

async function waitForOnboardingRows(client, userId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: profile } = await client
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    const { data: categories } = await client
      .from("categories")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (profile && categories && categories.length > 0) {
      return;
    }

    await delay(250);
  }

  throw new Error("Timed out waiting for profile/default categories.");
}

async function getCategory(client, userId) {
  const { data, error } = await client
    .from("categories")
    .select("id, name")
    .eq("user_id", userId)
    .eq("name", DEFAULT_CATEGORY_NAME)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Unable to read smoke category: ${error?.message}`);
  }

  return data;
}

async function archiveSmokeBehavior(client, behavior) {
  const recordedAt = "2000-01-02T18:00:00Z";
  const snapshotGraph = behavior.scheduleGraph.map((schedule) => ({
    recurrence_rule: schedule.recurrence_rule,
    sort_order: schedule.sort_order,
    time_entries: schedule.time_entries.map((entry) => ({
      kind: entry.kind,
      preset: entry.preset,
      start_time: entry.start_time,
      end_time: entry.end_time,
      sort_order: entry.sort_order,
    })),
  }));
  const previousConfiguration = {
    category_id: behavior.category_id,
    location_text: behavior.location_text ?? null,
    schedule_graph: snapshotGraph,
    browser_reminder_enabled: behavior.browser_reminder_enabled,
    email_reminder_enabled: behavior.email_reminder_enabled,
    reminder_offset_minutes: behavior.reminder_offset_minutes,
    active: true,
    timezone: behavior.timezone,
  };
  const { data, error } = await client.rpc(
    "update_behavior_with_schedule_graph",
    {
      target_behavior_id: behavior.id,
      behavior_payload: {
        category_id: behavior.category_id,
        title: behavior.title,
        description: behavior.description,
        location_text: behavior.location_text ?? null,
        recurrence_rule: behavior.recurrence_rule,
        scheduled_time: behavior.scheduled_time,
        timezone: behavior.timezone,
        browser_reminder_enabled: behavior.browser_reminder_enabled,
        email_reminder_enabled: behavior.email_reminder_enabled,
        reminder_offset_minutes: behavior.reminder_offset_minutes,
        active: false,
        archived_at: recordedAt,
      },
      expected_definition: {
        stored_title: behavior.title,
        stored_description: behavior.description,
        normalized_title: behavior.title,
        normalized_description: behavior.description,
      },
      expected_schedule_graph: behavior.scheduleGraph,
      expected_updated_at: behavior.updated_at,
      definition_event_plan: null,
      configuration_event_plan: {
        event_kind: "revision",
        previous_configuration: previousConfiguration,
        next_configuration: { ...previousConfiguration, active: false },
        changed_fields: ["active"],
        recorded_at: recordedAt,
        effective_at: recordedAt,
        effective_local_date: "2000-01-02",
        timezone: behavior.timezone,
        source: "manual",
        reason_code: "behavior_archived",
      },
      schedule_graph: behavior.scheduleGraph,
    },
  );

  if (error || !data) {
    throw new Error(`Unable to archive smoke behavior: ${error?.message}`);
  }
}

async function createSmokeBehavior(client, input) {
  const recordedAt = "2000-01-01T14:00:00Z";
  const scheduleGraph = [
    {
      recurrence_rule: { frequency: "daily", interval: 1 },
      sort_order: 0,
      time_entries: [
        {
          kind: "exact",
          preset: null,
          start_time: "09:00:00",
          end_time: null,
          sort_order: 0,
        },
      ],
    },
  ];
  const behaviorPayload = {
      user_id: input.userId,
      category_id: input.categoryId,
      title: input.title,
      description: null,
      location_text: null,
      recurrence_rule: {
        frequency: "daily",
        interval: 1,
      },
      scheduled_time: "09:00",
      timezone: "America/New_York",
      browser_reminder_enabled: true,
      email_reminder_enabled: false,
      reminder_offset_minutes: 0,
      active: true,
      archived_at: null,
      created_at: recordedAt,
  };
  const { data, error } = await client.rpc(
    "create_behavior_with_schedule_graph",
    {
      behavior_payload: behaviorPayload,
      definition_event_plan: {
        previous_title: null,
        next_title: input.title,
        previous_description: null,
        next_description: null,
        changed_fields: ["title"],
        recorded_at: recordedAt,
        source: "manual",
        reason: null,
      },
      configuration_event_plan: {
        event_kind: "baseline",
        previous_configuration: null,
        next_configuration: {
          category_id: input.categoryId,
          location_text: null,
          schedule_graph: scheduleGraph,
          browser_reminder_enabled: true,
          email_reminder_enabled: false,
          reminder_offset_minutes: 0,
          active: true,
          timezone: "America/New_York",
        },
        changed_fields: [
          "category_id",
          "location_text",
          "schedule_graph",
          "browser_reminder_enabled",
          "email_reminder_enabled",
          "reminder_offset_minutes",
          "active",
          "timezone",
        ],
        recorded_at: recordedAt,
        effective_at: recordedAt,
        effective_local_date: "2000-01-01",
        timezone: "America/New_York",
        source: "manual",
        reason_code: "behavior_created",
      },
      schedule_graph: scheduleGraph,
    },
  );

  if (error || !data) {
    throw new Error(`Unable to create smoke behavior: ${error?.message}`);
  }

  const { data: schedules, error: scheduleError } = await client
    .from("behavior_schedules")
    .select(
      "id, recurrence_rule, sort_order, schedule_slots:behavior_schedule_slots!behavior_schedule_slots_schedule_owner_fkey(id, kind, preset, start_time, end_time, sort_order)",
    )
    .eq("behavior_id", data.id)
    .order("sort_order", { ascending: true });

  if (scheduleError || !schedules) {
    throw new Error(`Unable to read smoke behavior graph: ${scheduleError?.message}`);
  }

  return {
    ...data,
    scheduleGraph: schedules.map((schedule) => ({
      id: schedule.id,
      recurrence_rule: schedule.recurrence_rule,
      sort_order: schedule.sort_order,
      time_entries: schedule.schedule_slots.map((slot) => ({
        id: slot.id,
        kind: slot.kind,
        preset: slot.preset,
        start_time: slot.start_time,
        end_time: slot.end_time,
        sort_order: slot.sort_order,
      })),
    })),
  };
}

async function createSmokeOccurrence(client, input) {
  const { data, error } = await client
    .from("occurrences")
    .insert({
      user_id: input.userId,
      behavior_id: input.behaviorId,
      behavior_schedule_slot_id: null,
      scheduled_for: input.scheduledFor,
      local_date: input.localDate,
      schedule_kind: "exact",
      schedule_preset: null,
      schedule_start_time: "09:00:00",
      schedule_end_time: null,
      status: "unresolved",
      completed_at: null,
      status_marked_at: null,
      note: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create smoke occurrence: ${error?.message}`);
  }

  return data;
}

async function getBehaviorConfigurationEvent(client, behaviorId) {
  const { data, error } = await client
    .from("behavior_configuration_events")
    .select("id")
    .eq("behavior_id", behaviorId)
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to read owned behavior configuration history: ${error?.message}`,
    );
  }

  return data;
}

async function getBehaviorCurrentConfigurationEventId(client, behaviorId) {
  const { data, error } = await client
    .from("behaviors")
    .select("current_configuration_event_id")
    .eq("id", behaviorId)
    .single();

  if (error || !data?.current_configuration_event_id) {
    throw new Error(
      `Unable to read current behavior configuration event: ${error?.message}`,
    );
  }

  return data.current_configuration_event_id;
}

async function assertOccurrenceConfigurationLineage(input) {
  const directUpdate = await input.client
    .from("occurrences")
    .update({ behavior_configuration_event_id: input.currentEvent.id })
    .eq("id", input.occurrence.id);
  assertPermissionDenied(
    directUpdate.error,
    "setting occurrence configuration lineage directly",
  );

  const crossOwnerUpdate = await input.admin
    .from("occurrences")
    .update({ behavior_configuration_event_id: input.foreignEvent.id })
    .eq("id", input.occurrence.id);
  assertForeignKeyViolation(
    crossOwnerUpdate.error,
    "linking an occurrence to another owner's configuration event",
  );

  const wrongBehaviorUpdate = await input.admin
    .from("occurrences")
    .update({ behavior_configuration_event_id: input.staleSecondEvent.id })
    .eq("id", input.occurrence.id);
  assertForeignKeyViolation(
    wrongBehaviorUpdate.error,
    "linking an occurrence to another Behavior's configuration event",
  );

  const generatedScheduledFor = "2099-01-01T14:00:00Z";
  const generated = await input.client.rpc("apply_occurrence_generation_plan", {
    target_user_id: input.userId,
    target_behavior_id: input.behavior.id,
    expected_configuration_event_id: input.currentEvent.id,
    plan_now: "2098-12-31T00:00:00Z",
    occurrence_inserts: [
      {
        scheduled_for: generatedScheduledFor,
        local_date: "2099-01-01",
        behavior_schedule_slot_id: null,
        behavior_configuration_event_id: input.currentEvent.id,
        schedule_kind: "exact",
        schedule_preset: null,
        schedule_start_time: "09:00:00",
        schedule_end_time: null,
      },
    ],
    occurrence_updates: [],
    occurrence_deletes: [],
  });
  assertNoError(generated.error, "applying an owned occurrence generation plan");

  const { data: generatedOccurrence, error: generatedReadError } =
    await input.client
      .from("occurrences")
      .select("id, behavior_configuration_event_id")
      .eq("behavior_id", input.behavior.id)
      .eq("scheduled_for", generatedScheduledFor)
      .single();
  assertNoError(generatedReadError, "reading generated occurrence lineage");

  if (
    generatedOccurrence?.behavior_configuration_event_id !==
    input.currentEvent.id
  ) {
    throw new Error("Occurrence generation did not persist current lineage.");
  }

  const generationUpdate = await input.client.rpc(
    "apply_occurrence_generation_plan",
    {
      target_user_id: input.userId,
      target_behavior_id: input.behavior.id,
      expected_configuration_event_id: input.currentEvent.id,
      plan_now: "2098-12-31T00:00:00Z",
      occurrence_inserts: [],
      occurrence_updates: [
        {
          id: generatedOccurrence.id,
          previous_scheduled_for: generatedScheduledFor,
          scheduled_for: generatedScheduledFor,
          local_date: "2099-01-01",
          behavior_schedule_slot_id: null,
          behavior_configuration_event_id: input.currentEvent.id,
          schedule_kind: "range",
          schedule_preset: null,
          schedule_start_time: "09:00:00",
          schedule_end_time: "10:00:00",
        },
      ],
      occurrence_deletes: [],
    },
  );
  assertNoError(
    generationUpdate.error,
    "applying a two-step occurrence snapshot and lineage update",
  );

  const { data: updatedGenerated, error: updatedGeneratedError } =
    await input.client
      .from("occurrences")
      .select("behavior_configuration_event_id, schedule_end_time")
      .eq("id", generatedOccurrence.id)
      .single();
  assertNoError(updatedGeneratedError, "reading two-step generated lineage");

  if (
    updatedGenerated?.behavior_configuration_event_id !== input.currentEvent.id ||
    updatedGenerated.schedule_end_time !== "10:00:00"
  ) {
    throw new Error("Two-step generation did not restore current lineage.");
  }

  const statusAndNoteUpdate = await input.client
    .from("occurrences")
    .update({
      status: "completed",
      completed_at: "2099-01-01T14:05:00Z",
      status_marked_at: "2099-01-01T14:05:00Z",
      note: "Lineage preservation smoke",
    })
    .eq("id", generatedOccurrence.id);
  assertNoError(
    statusAndNoteUpdate.error,
    "updating status and note without changing lineage",
  );

  const { data: statusUpdated, error: statusUpdatedError } = await input.client
    .from("occurrences")
    .select("behavior_configuration_event_id")
    .eq("id", generatedOccurrence.id)
    .single();
  assertNoError(statusUpdatedError, "reading status-only lineage");

  if (statusUpdated?.behavior_configuration_event_id !== input.currentEvent.id) {
    throw new Error("A status/note-only update cleared occurrence lineage.");
  }

  const restoreStyleUpdate = await input.admin
    .from("occurrences")
    .update({ schedule_start_time: "09:00:00" })
    .eq("id", generatedOccurrence.id);
  assertNoError(
    restoreStyleUpdate.error,
    "applying a restore-style same-value schedule snapshot update",
  );

  const { data: restoredSnapshot, error: restoredSnapshotError } =
    await input.client
      .from("occurrences")
      .select("behavior_configuration_event_id")
      .eq("id", generatedOccurrence.id)
      .single();
  assertNoError(restoredSnapshotError, "reading restore-cleared lineage");

  if (restoredSnapshot?.behavior_configuration_event_id !== null) {
    throw new Error("A restore-style snapshot update retained false lineage.");
  }

  const currentSecondEventId = await getBehaviorCurrentConfigurationEventId(
    input.client,
    input.secondBehavior.id,
  );
  const plannedStateVersion = await getOccurrenceSyncStateVersion(
    input.client,
    input.userId,
  );
  const staleFreshness = await input.client.rpc(
    "mark_occurrence_sync_fresh_if_configuration_current",
    occurrenceFreshnessArgs(
      input,
      input.staleSecondEvent.id,
      plannedStateVersion,
    ),
  );
  assertStalePlanFailure(
    staleFreshness.error,
    "marking occurrence sync fresh with a stale configuration set",
  );

  const { data: staleState, error: staleStateError } = await input.client
    .from("occurrence_sync_state")
    .select("stale")
    .eq("user_id", input.userId)
    .single();
  assertNoError(staleStateError, "reading rejected occurrence sync state");

  if (!staleState?.stale) {
    throw new Error("A stale freshness plan cleared occurrence sync staleness.");
  }

  const currentFreshness = await input.client.rpc(
    "mark_occurrence_sync_fresh_if_configuration_current",
    occurrenceFreshnessArgs(input, currentSecondEventId, plannedStateVersion),
  );
  assertNoError(
    currentFreshness.error,
    "marking occurrence sync fresh with the exact configuration set",
  );

  return [
    "occurrence_lineage_direct_update_denied",
    "occurrence_lineage_cross_owner_fk",
    "occurrence_lineage_wrong_behavior_fk",
    "occurrence_generation_authenticated_rpc",
    "occurrence_generation_two_step_lineage",
    "occurrence_status_note_lineage_preserved",
    "occurrence_restore_snapshot_lineage_cleared",
    "occurrence_freshness_stale_plan_rejected",
    "occurrence_freshness_exact_set",
    await assertOccurrenceOnlyStaleWriteWins({
      ...input,
      currentSecondEventId,
    }),
  ];
}

async function assertOccurrenceOnlyStaleWriteWins(input) {
  const plannedStateVersion = await getOccurrenceSyncStateVersion(
    input.client,
    input.userId,
  );
  const forgedVersion = await input.client
    .from("occurrence_sync_state")
    .update({ state_version: plannedStateVersion + 100 })
    .eq("user_id", input.userId);
  assertPermissionDenied(
    forgedVersion.error,
    "setting occurrence sync state version directly",
  );

  const staleWrite = await input.client
    .from("occurrence_sync_state")
    .upsert({
      user_id: input.userId,
      stale: true,
      stale_reason: "behaviorlog_import_applied",
    }, { onConflict: "user_id" });
  assertNoError(
    staleWrite.error,
    "upserting an existing occurrence-only import stale state",
  );
  const staleStateVersion = await getOccurrenceSyncStateVersion(
    input.client,
    input.userId,
  );

  if (staleStateVersion <= plannedStateVersion) {
    throw new Error("Occurrence sync stale upsert did not increment state version.");
  }

  const freshness = await input.client.rpc(
    "mark_occurrence_sync_fresh_if_configuration_current",
    occurrenceFreshnessArgs(
      input,
      input.currentSecondEventId,
      plannedStateVersion,
    ),
  );
  assertStalePlanFailure(
    freshness.error,
    "clearing an occurrence-only stale write with an older sync plan",
  );

  const { data: state, error } = await input.client
    .from("occurrence_sync_state")
    .select("stale")
    .eq("user_id", input.userId)
    .single();
  assertNoError(error, "reading occurrence-only stale state");

  if (!state?.stale) {
    throw new Error("An older sync plan cleared occurrence-only stale state.");
  }

  return "occurrence_freshness_state_version_race_and_forgery_denial";
}

async function assertZeroBehaviorFreshnessRejectsConcurrentStateCreation(input) {
  const { data: initialState, error: initialStateError } = await input.client
    .from("occurrence_sync_state")
    .select("state_version")
    .eq("user_id", input.userId)
    .maybeSingle();
  assertNoError(initialStateError, "reading initial zero-Behavior sync state");

  if (initialState) {
    throw new Error("Zero-Behavior freshness fixture unexpectedly had sync state.");
  }

  const timezoneWrite = await input.client
    .from("occurrence_sync_state")
    .insert({
      user_id: input.userId,
      timezone: "America/Chicago",
      stale: true,
      stale_reason: "timezone_changed",
    });
  assertNoError(
    timezoneWrite.error,
    "creating a zero-Behavior timezone stale state",
  );

  const freshness = await input.client.rpc(
    "mark_occurrence_sync_fresh_if_configuration_current",
    {
      target_user_id: input.userId,
      expected_behavior_configuration_events: [],
      expected_sync_state_exists: false,
      expected_sync_state_version: -1,
      target_timezone: "America/New_York",
      target_last_synced_local_date: "2098-12-31",
      target_synced_through_local_date: "2099-01-30",
      target_last_successful_sync_at: "2098-12-31T00:00:00Z",
      target_behavior_count: 0,
      target_created_count: 0,
      target_updated_count: 0,
      target_deleted_count: 0,
    },
  );
  assertStalePlanFailure(
    freshness.error,
    "clearing a zero-Behavior timezone stale-state creation",
  );

  return "occurrence_freshness_zero_behavior_state_creation_race";
}

async function getOccurrenceSyncStateVersion(client, userId) {
  const { data, error } = await client
    .from("occurrence_sync_state")
    .select("state_version")
    .eq("user_id", userId)
    .single();
  assertNoError(error, "reading occurrence sync state version");

  if (!Number.isInteger(data?.state_version)) {
    throw new Error("Occurrence sync state version is unavailable.");
  }

  return data.state_version;
}

function occurrenceFreshnessArgs(
  input,
  secondConfigurationEventId,
  expectedSyncStateVersion,
) {
  return {
    target_user_id: input.userId,
    expected_behavior_configuration_events: [
      {
        behavior_id: input.behavior.id,
        configuration_event_id: input.currentEvent.id,
      },
      {
        behavior_id: input.secondBehavior.id,
        configuration_event_id: secondConfigurationEventId,
      },
    ],
    expected_sync_state_exists: true,
    expected_sync_state_version: expectedSyncStateVersion,
    target_timezone: "America/New_York",
    target_last_synced_local_date: "2098-12-31",
    target_synced_through_local_date: "2099-01-30",
    target_last_successful_sync_at: "2098-12-31T00:00:00Z",
    target_behavior_count: 2,
    target_created_count: 1,
    target_updated_count: 0,
    target_deleted_count: 0,
  };
}

async function assertBehaviorConfigurationEventIsolation(
  client,
  otherBehaviorId,
) {
  const { data, error } = await client
    .from("behavior_configuration_events")
    .select("id")
    .eq("behavior_id", otherBehaviorId);

  assertNoError(error, "reading another user's behavior configuration history");
  assertNoRows(data, "another user's behavior configuration history");

  return "configuration_event_select";
}

async function assertBehaviorConfigurationEventAppendOnly(input) {
  const previousConfiguration = {
    category_id: null,
    location_text: null,
    schedule_graph: [],
    browser_reminder_enabled: true,
    email_reminder_enabled: false,
    reminder_offset_minutes: 0,
    active: true,
    timezone: "America/New_York",
  };
  const nextConfiguration = {
    ...previousConfiguration,
    timezone: "America/Los_Angeles",
  };
  const insertResult = await input.client
    .from("behavior_configuration_events")
    .insert({
      user_id: input.userId,
      behavior_id: input.behaviorId,
      event_kind: "revision",
      previous_configuration: previousConfiguration,
      next_configuration: nextConfiguration,
      changed_fields: ["timezone"],
      recorded_at: "2000-01-01T14:00:00Z",
      effective_at: "2000-01-01T14:00:00Z",
      effective_local_date: "2000-01-01",
      timezone: "America/Los_Angeles",
      source: "manual",
      reason_code: "forged_smoke_event",
    });
  assertPermissionDenied(
    insertResult.error,
    "inserting behavior configuration history directly",
  );

  const updateResult = await input.client
    .from("behavior_configuration_events")
    .update({ reason_code: "forged_update" })
    .eq("id", input.eventId);
  assertPermissionDenied(
    updateResult.error,
    "updating behavior configuration history directly",
  );

  const deleteResult = await input.client
    .from("behavior_configuration_events")
    .delete()
    .eq("id", input.eventId);
  assertPermissionDenied(
    deleteResult.error,
    "deleting behavior configuration history directly",
  );

  return [
    "configuration_event_insert_denied",
    "configuration_event_update_denied",
    "configuration_event_delete_denied",
  ];
}

function assertPermissionDenied(error, action) {
  if (
    !error ||
    (error.code !== "42501" && !/permission denied/iu.test(error.message ?? ""))
  ) {
    throw new Error(`Expected permission denial while ${action}.`);
  }
}

function assertForeignKeyViolation(error, action) {
  if (!error || error.code !== "23503") {
    throw new Error(`Expected owner-and-Behavior foreign-key failure while ${action}.`);
  }
}

function assertStalePlanFailure(error, action) {
  if (!error || error.code !== "P0001") {
    throw new Error(
      `Expected stale-plan rejection while ${action}; received ${
        error ? `${error.code}: ${error.message}` : "success"
      }.`,
    );
  }
}

async function createSmokeTimeSession(client, input) {
  const { data, error } = await client
    .from("occurrence_time_sessions")
    .insert({
      user_id: input.userId,
      occurrence_id: input.occurrenceId,
      behavior_id: input.behaviorId,
      started_at: input.startedAt,
      stopped_at: input.stoppedAt,
    })
    .select("id, started_at")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create smoke time session: ${error?.message}`);
  }

  return data;
}

async function assertTimeSessionRpcIsolation(input) {
  const assertions = [];

  const ordinaryRead = await input.clientA
    .from("occurrence_time_sessions")
    .select("id")
    .in("occurrence_id", [input.occurrenceA.id, input.occurrenceB.id]);
  assertSuccessfulSessionRows(
    ordinaryRead,
    [input.timeSessionA.id],
    "ordinary time-session owner read",
  );
  assertions.push("time_session_table_mixed_owner");

  await assertIdRpcRows(
    input.clientA,
    [input.occurrenceA.id],
    [input.timeSessionA.id],
    "own arbitrary-ID read",
  );
  assertions.push("time_session_id_own");

  await assertIdRpcRows(
    input.clientA,
    [input.occurrenceB.id],
    [],
    "foreign arbitrary-ID read",
  );
  assertions.push("time_session_id_foreign");

  await assertIdRpcRows(
    input.clientA,
    [input.occurrenceA.id, input.occurrenceB.id],
    [input.timeSessionA.id],
    "mixed arbitrary-ID read",
  );
  assertions.push("time_session_id_mixed");

  await assertIdRpcRows(
    input.clientA,
    [input.occurrenceA.id, input.occurrenceA.id],
    [input.timeSessionA.id],
    "duplicate arbitrary-ID read",
  );
  assertions.push("time_session_id_duplicate");

  await assertIdRpcRows(input.clientA, [], [], "empty arbitrary-ID read");
  await assertIdRpcRows(input.clientA, null, [], "null arbitrary-ID read");
  assertions.push("time_session_id_empty_and_null");

  const overLimit = await input.clientA.rpc(
    "list_my_occurrence_time_sessions",
    {
      occurrence_ids: Array.from({ length: 2_001 }, () => randomUUID()),
    },
  );
  assertRpcRejected(overLimit, "over-limit arbitrary-ID read", "maximum of 2000");
  assertions.push("time_session_id_over_limit");

  await assertHistoryRpcRows(
    input.clientA,
    historyArgs({ start: "2000-01-01", end: "2000-01-01" }),
    [input.timeSessionA.id],
    "own history read",
  );
  assertions.push("time_session_history_own");

  await assertHistoryRpcRows(
    input.clientB,
    historyArgs({
      start: "2000-01-02",
      end: "2000-01-02",
      includeArchived: true,
    }),
    [input.timeSessionB.id],
    "archived owner history read",
  );
  assertions.push("time_session_history_archived_own");

  await assertHistoryRpcRows(
    input.clientB,
    historyArgs({
      start: "2000-01-02",
      end: "2000-01-02",
      includeArchived: false,
    }),
    [],
    "archived owner history exclusion",
  );
  assertions.push("time_session_history_archived_excluded");

  await assertHistoryRpcRows(
    input.clientA,
    historyArgs({
      start: "2000-01-01",
      end: "2000-01-01",
      throughStartedAt: "2000-01-01T13:59:59Z",
    }),
    [],
    "history high-water exclusion",
  );
  assertions.push("time_session_history_high_water");

  await assertHistoryRpcRows(
    input.clientA,
    historyArgs({
      start: "2000-01-02",
      end: "2000-01-02",
      includeArchived: true,
    }),
    [],
    "foreign history read",
  );
  assertions.push("time_session_history_foreign");

  for (const includeArchived of [false, true]) {
    await assertHistoryRpcRows(
      input.clientA,
      historyArgs({
        start: "2000-01-01",
        end: "2000-01-02",
        includeArchived,
      }),
      [input.timeSessionA.id],
      "mixed history read",
    );
  }
  assertions.push("time_session_history_mixed_archive");

  await assertHistoryRpcRows(
    input.clientA,
    historyArgs({
      start: "2000-01-01",
      end: "2000-01-02",
      includeArchived: true,
      cursorStartedAt: input.timeSessionB.started_at,
      cursorSessionId: input.timeSessionB.id,
    }),
    [],
    "foreign-cursor history read",
  );
  assertions.push("time_session_history_foreign_cursor");

  const invalidHistoryCalls = [
    input.clientA.rpc(
      "list_my_occurrence_time_session_history",
      historyArgs({ start: "2000-01-02", end: "2000-01-01" }),
    ),
    input.clientA.rpc("list_my_occurrence_time_session_history", {
      ...historyArgs({ start: "2000-01-01", end: "2000-01-02" }),
      cursor_started_at: input.timeSessionA.started_at,
      cursor_session_id: null,
    }),
    input.clientA.rpc("list_my_occurrence_time_session_history", {
      ...historyArgs({ start: "2000-01-01", end: "2000-01-02" }),
      page_size: 0,
    }),
    input.clientA.rpc("list_my_occurrence_time_session_history", {
      ...historyArgs({ start: "2000-01-01", end: "2000-01-02" }),
      page_size: 1_001,
    }),
  ];

  for (const [index, call] of invalidHistoryCalls.entries()) {
    assertRpcRejected(
      await call,
      `invalid history read ${index + 1}`,
    );
  }
  assertions.push("time_session_history_invalid_inputs");

  return assertions;
}

async function assertAnonymousTimeSessionRpcDenial(config) {
  const anonymous = createSupabase(config.url, config.publishableKey);
  const idRead = await anonymous.rpc("list_my_occurrence_time_sessions", {
    occurrence_ids: [],
  });
  const historyRead = await anonymous.rpc(
    "list_my_occurrence_time_session_history",
    historyArgs({ start: "2000-01-01", end: "2000-01-02" }),
  );

  assertRpcRejected(idRead, "anonymous arbitrary-ID read");
  assertRpcRejected(historyRead, "anonymous history read");

  return ["time_session_id_anon_denied", "time_session_history_anon_denied"];
}

async function assertIdRpcRows(client, occurrenceIds, expectedIds, action) {
  const response = await client.rpc("list_my_occurrence_time_sessions", {
    occurrence_ids: occurrenceIds,
  });
  assertSuccessfulSessionRows(response, expectedIds, action);
}

async function assertHistoryRpcRows(client, args, expectedIds, action) {
  const response = await client.rpc(
    "list_my_occurrence_time_session_history",
    args,
  );
  assertSuccessfulSessionRows(response, expectedIds, action);
}

function historyArgs(input) {
  return {
    range_start_local_date: input.start,
    range_end_local_date: input.end,
    include_archived: input.includeArchived ?? false,
    through_started_at: input.throughStartedAt ?? "2000-01-03T00:00:00Z",
    cursor_started_at: input.cursorStartedAt ?? null,
    cursor_session_id: input.cursorSessionId ?? null,
    page_size: 1_000,
  };
}

export function assertSuccessfulSessionRows(response, expectedIds, action) {
  if (response.error) {
    throw new Error(`Unexpected error during ${action}: ${response.error.message}`);
  }

  const rows = response.data ?? [];
  const expected = new Set(expectedIds);

  if (
    rows.length !== expected.size ||
    rows.some((row) => !expected.has(row.id))
  ) {
    throw new Error(`RLS returned an unexpected time-session scope during ${action}.`);
  }
}

function assertRpcRejected(response, action, expectedMessage) {
  if (!response.error) {
    throw new Error(`RPC unexpectedly allowed ${action}.`);
  }

  if (
    expectedMessage &&
    !response.error.message.toLowerCase().includes(expectedMessage.toLowerCase())
  ) {
    throw new Error(
      `RPC rejected ${action} with an unexpected safe error: ${response.error.message}`,
    );
  }
}

async function assertProfileIsolation(client, otherUserId) {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("id", otherUserId);

  assertNoError(error, "reading another user's profile");
  assertNoRows(data, "another user's profile");

  return "profile_select";
}

async function assertProfileWriteIntegrity(input) {
  const timezoneUpdate = await input.client
    .from("profiles")
    .update({ timezone: "America/Chicago" })
    .eq("id", input.user.id)
    .select("timezone")
    .single();
  assertNoError(timezoneUpdate.error, "updating the owned profile timezone");

  if (timezoneUpdate.data?.timezone !== "America/Chicago") {
    throw new Error("Owned profile timezone update did not persist.");
  }

  const emailUpdate = await input.client
    .from("profiles")
    .update({ email: input.updatedEmail })
    .eq("id", input.user.id);
  assertPermissionDenied(emailUpdate.error, "updating the owned profile email");

  const displayNameUpdate = await input.client
    .from("profiles")
    .update({ display_name: "Forged reminder recipient" })
    .eq("id", input.user.id);
  assertPermissionDenied(
    displayNameUpdate.error,
    "updating the owned profile display name",
  );

  const profileDelete = await input.client
    .from("profiles")
    .delete()
    .eq("id", input.user.id);
  assertPermissionDenied(profileDelete.error, "deleting the owned profile");

  const profileInsert = await input.client.from("profiles").insert({
    id: input.user.id,
    email: input.updatedEmail,
    display_name: null,
    timezone: "America/Chicago",
  });
  assertPermissionDenied(profileInsert.error, "inserting an owned profile");

  const identityUpdate = await input.admin.auth.admin.updateUserById(
    input.user.id,
    {
      email: input.updatedEmail,
      email_confirm: true,
    },
  );
  assertNoError(
    identityUpdate.error,
    "updating the temporary identity-provider email",
  );

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await input.client
      .from("profiles")
      .select("email")
      .eq("id", input.user.id)
      .single();
    assertNoError(error, "reading the identity-synced profile email");

    if (data?.email === input.updatedEmail) {
      return [
        "profile_timezone_update",
        "profile_email_update_denied",
        "profile_display_name_update_denied",
        "profile_delete_denied",
        "profile_insert_denied",
        "profile_identity_email_sync",
      ];
    }

    await delay(250);
  }

  throw new Error("Identity-provider email did not propagate to the profile.");
}

async function assertSettingsTimezoneTransaction(input) {
  const { data: profileBefore, error: profileBeforeError } = await input.client
    .from("profiles")
    .select("timezone")
    .eq("id", input.userId)
    .single();
  assertNoError(profileBeforeError, "reading pre-timezone profile state");

  const { data: behaviorBefore, error: behaviorBeforeError } = await input.client
    .from("behaviors")
    .select("updated_at, timezone, current_configuration_event_id")
    .eq("id", input.behavior.id)
    .single();
  assertNoError(behaviorBeforeError, "reading pre-timezone Behavior state");

  const { count: eventCountBefore, error: eventCountBeforeError } =
    await input.client
      .from("behavior_configuration_events")
      .select("id", { count: "exact", head: true })
      .eq("behavior_id", input.behavior.id);
  assertNoError(
    eventCountBeforeError,
    "counting pre-timezone configuration events",
  );

  const syncBefore = await readOccurrenceSyncState(input.client, input.userId);
  const targetTimezone = "America/Los_Angeles";
  const eventPlan = buildTimezoneConfigurationEventPlan(
    input.behavior,
    targetTimezone,
  );
  const failedWrite = await input.client.rpc(
    "update_profile_and_behavior_timezones_with_config_events",
    {
      target_timezone: targetTimezone,
      expected_profile_timezone: profileBefore.timezone,
      behavior_changes: [
        {
          behavior_id: input.behavior.id,
          expected_updated_at: "1999-01-01T00:00:00Z",
          configuration_event_plan: eventPlan,
        },
      ],
    },
  );
  assertRpcRejected(
    failedWrite,
    "a timezone write with a changed Behavior precondition",
    "Active behavior changed after it was read",
  );

  await assertTimezoneTransactionState(input.client, {
    userId: input.userId,
    behaviorId: input.behavior.id,
    expectedProfileTimezone: profileBefore.timezone,
    expectedBehaviorTimezone: behaviorBefore.timezone,
    expectedConfigurationEventId:
      behaviorBefore.current_configuration_event_id,
    expectedEventCount: eventCountBefore,
    expectedSyncState: syncBefore,
    action: "rejected timezone transaction rollback",
  });

  const successfulWrite = await input.client.rpc(
    "update_profile_and_behavior_timezones_with_config_events",
    {
      target_timezone: targetTimezone,
      expected_profile_timezone: profileBefore.timezone,
      behavior_changes: [
        {
          behavior_id: input.behavior.id,
          expected_updated_at: behaviorBefore.updated_at,
          configuration_event_plan: eventPlan,
        },
      ],
    },
  );
  assertNoError(successfulWrite.error, "saving an atomic Settings timezone");

  if (
    successfulWrite.data?.active_behavior_count !== 1 ||
    successfulWrite.data?.changed_behavior_count !== 1 ||
    successfulWrite.data?.profile_changed !== true
  ) {
    throw new Error("Atomic Settings timezone result counts were incorrect.");
  }

  const { data: profileAfter, error: profileAfterError } = await input.client
    .from("profiles")
    .select("timezone")
    .eq("id", input.userId)
    .single();
  assertNoError(profileAfterError, "reading committed timezone profile state");

  const { data: behaviorAfter, error: behaviorAfterError } = await input.client
    .from("behaviors")
    .select("timezone, current_configuration_event_id")
    .eq("id", input.behavior.id)
    .single();
  assertNoError(behaviorAfterError, "reading committed timezone Behavior state");

  const { count: eventCountAfter, error: eventCountAfterError } =
    await input.client
      .from("behavior_configuration_events")
      .select("id", { count: "exact", head: true })
      .eq("behavior_id", input.behavior.id);
  assertNoError(
    eventCountAfterError,
    "counting committed timezone configuration events",
  );
  const syncAfter = await readOccurrenceSyncState(input.client, input.userId);

  if (
    profileAfter.timezone !== targetTimezone ||
    behaviorAfter.timezone !== targetTimezone ||
    behaviorAfter.current_configuration_event_id ===
      behaviorBefore.current_configuration_event_id ||
    eventCountAfter !== eventCountBefore + 1 ||
    !syncAfter.stale ||
    syncAfter.stale_reason !== "timezone_changed" ||
    syncAfter.timezone !== targetTimezone ||
    syncAfter.state_version !== syncBefore.state_version + 1
  ) {
    throw new Error(
      "Atomic Settings timezone did not commit one profile, Behavior, history, and stale-state boundary.",
    );
  }

  const staleProfileWrite = await input.client.rpc(
    "update_profile_and_behavior_timezones_with_config_events",
    {
      target_timezone: "America/Denver",
      expected_profile_timezone: profileBefore.timezone,
      behavior_changes: [],
    },
  );
  assertRpcRejected(
    staleProfileWrite,
    "a timezone write with a stale profile precondition",
    "Profile timezone changed after it was read",
  );

  const syncAfterStaleAttempt = await readOccurrenceSyncState(
    input.client,
    input.userId,
  );

  if (syncAfterStaleAttempt.state_version !== syncAfter.state_version) {
    throw new Error("A rejected concurrent timezone write marked sync stale.");
  }

  return [
    "settings_timezone_behavior_failure_rollback",
    "settings_timezone_profile_behavior_atomic_commit",
    "settings_timezone_configuration_event_once",
    "settings_timezone_stale_mark_once",
    "settings_timezone_stale_profile_precondition",
  ];
}

function buildTimezoneConfigurationEventPlan(behavior, targetTimezone) {
  const previousConfiguration = {
    category_id: behavior.category_id,
    location_text: behavior.location_text ?? null,
    schedule_graph: behavior.scheduleGraph.map((schedule) => ({
      recurrence_rule: schedule.recurrence_rule,
      sort_order: schedule.sort_order,
      time_entries: schedule.time_entries.map((entry) => ({
        kind: entry.kind,
        preset: entry.preset,
        start_time: entry.start_time,
        end_time: entry.end_time,
        sort_order: entry.sort_order,
      })),
    })),
    browser_reminder_enabled: behavior.browser_reminder_enabled,
    email_reminder_enabled: behavior.email_reminder_enabled,
    reminder_offset_minutes: behavior.reminder_offset_minutes,
    active: true,
    timezone: behavior.timezone,
  };

  return {
    event_kind: "revision",
    previous_configuration: previousConfiguration,
    next_configuration: {
      ...previousConfiguration,
      timezone: targetTimezone,
    },
    changed_fields: ["timezone"],
    recorded_at: "2000-01-03T18:00:00Z",
    effective_at: "2000-01-03T18:00:00Z",
    effective_local_date: "2000-01-03",
    timezone: targetTimezone,
    source: "manual",
    reason_code: "timezone_changed",
  };
}

async function assertTimezoneTransactionState(client, expected) {
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("timezone")
    .eq("id", expected.userId)
    .single();
  assertNoError(profileError, `reading ${expected.action} profile`);

  const { data: behavior, error: behaviorError } = await client
    .from("behaviors")
    .select("timezone, current_configuration_event_id")
    .eq("id", expected.behaviorId)
    .single();
  assertNoError(behaviorError, `reading ${expected.action} Behavior`);

  const { count: eventCount, error: eventCountError } = await client
    .from("behavior_configuration_events")
    .select("id", { count: "exact", head: true })
    .eq("behavior_id", expected.behaviorId);
  assertNoError(eventCountError, `counting ${expected.action} history`);
  const syncState = await readOccurrenceSyncState(client, expected.userId);

  if (
    profile.timezone !== expected.expectedProfileTimezone ||
    behavior.timezone !== expected.expectedBehaviorTimezone ||
    behavior.current_configuration_event_id !==
      expected.expectedConfigurationEventId ||
    eventCount !== expected.expectedEventCount ||
    JSON.stringify(syncState) !== JSON.stringify(expected.expectedSyncState)
  ) {
    throw new Error(`Database state changed during ${expected.action}.`);
  }
}

async function readOccurrenceSyncState(client, userId) {
  const { data, error } = await client
    .from("occurrence_sync_state")
    .select("timezone, stale, stale_reason, state_version")
    .eq("user_id", userId)
    .single();
  assertNoError(error, "reading occurrence sync state for timezone proof");
  return data;
}

async function assertReminderDeliveryIntegrity(input) {
  const scheduledSendAt = {
    cancellation: "2000-01-01T13:00:00Z",
    sent: "2000-01-01T13:01:00Z",
    failed: "2000-01-01T13:02:00Z",
    claimed: "2000-01-01T13:03:00Z",
  };
  const { data: inserted, error: insertError } = await input.client
    .from("reminder_deliveries")
    .insert(
      Object.values(scheduledSendAt).map((sendAt, index) => ({
        user_id: input.userId,
        occurrence_id: input.occurrenceId,
        channel: index % 2 === 0 ? "email" : "browser_push",
        scheduled_send_at: sendAt,
        status: "pending",
      })),
    )
    .select("id, scheduled_send_at");
  assertNoError(insertError, "planning owned pending reminder deliveries");

  if (inserted?.length !== 4) {
    throw new Error("Owned reminder planning did not create every fixture.");
  }

  const idByScheduledSendAt = new Map(
    inserted.map((delivery) => [
      Date.parse(delivery.scheduled_send_at),
      delivery.id,
    ]),
  );
  const cancellationId = idByScheduledSendAt.get(
    Date.parse(scheduledSendAt.cancellation),
  );
  const sentId = idByScheduledSendAt.get(Date.parse(scheduledSendAt.sent));
  const failedId = idByScheduledSendAt.get(Date.parse(scheduledSendAt.failed));
  const claimedId = idByScheduledSendAt.get(Date.parse(scheduledSendAt.claimed));

  if (!cancellationId || !sentId || !failedId || !claimedId) {
    throw new Error("Owned reminder planning returned incomplete fixtures.");
  }

  const cancellation = await input.client
    .from("reminder_deliveries")
    .update({ status: "cancelled", error: null })
    .eq("id", cancellationId);
  assertNoError(cancellation.error, "cancelling an owned pending reminder");

  const reactivation = await input.client
    .from("reminder_deliveries")
    .update({
      status: "pending",
      sent_at: null,
      processing_started_at: null,
      error: null,
    })
    .eq("id", cancellationId);
  assertNoError(
    reactivation.error,
    "reactivating an owned unclaimed cancelled reminder",
  );

  const sentUpdate = await input.admin
    .from("reminder_deliveries")
    .update({
      status: "sent",
      sent_at: "2000-01-01T13:01:30Z",
      error: null,
    })
    .eq("id", sentId);
  assertNoError(sentUpdate.error, "marking the reminder sent as service role");

  const failedUpdate = await input.admin
    .from("reminder_deliveries")
    .update({ status: "failed", sent_at: null, error: "smoke failure" })
    .eq("id", failedId);
  assertNoError(
    failedUpdate.error,
    "marking the reminder failed as service role",
  );

  const claimStartedAt = "2000-01-01T13:03:30Z";
  const claimUpdate = await input.admin
    .from("reminder_deliveries")
    .update({ processing_started_at: claimStartedAt })
    .eq("id", claimedId);
  assertNoError(claimUpdate.error, "claiming the reminder as service role");

  const sentRecycle = await input.client
    .from("reminder_deliveries")
    .update({ status: "pending", sent_at: null, error: null })
    .eq("id", sentId);
  assertPermissionDenied(sentRecycle.error, "recycling a sent reminder");

  const failedRecycle = await input.client
    .from("reminder_deliveries")
    .update({ status: "pending", error: null })
    .eq("id", failedId);
  assertPermissionDenied(failedRecycle.error, "recycling a failed reminder");

  const claimClear = await input.client
    .from("reminder_deliveries")
    .update({ processing_started_at: null })
    .eq("id", claimedId);
  assertPermissionDenied(claimClear.error, "clearing a reminder processing claim");

  const { data: guardedRows, error: guardedReadError } = await input.client
    .from("reminder_deliveries")
    .select("id, status, processing_started_at")
    .in("id", [sentId, failedId, claimedId]);
  assertNoError(guardedReadError, "reading guarded reminder delivery states");

  const guardedById = new Map(
    (guardedRows ?? []).map((delivery) => [delivery.id, delivery]),
  );

  if (
    guardedById.get(sentId)?.status !== "sent" ||
    guardedById.get(failedId)?.status !== "failed" ||
    guardedById.get(claimedId)?.processing_started_at === null
  ) {
    throw new Error("A rejected reminder delivery update changed guarded state.");
  }

  return [
    "reminder_pending_planning",
    "reminder_pending_cancellation",
    "reminder_cancelled_reactivation",
    "reminder_sent_recycle_denied",
    "reminder_failed_recycle_denied",
    "reminder_processing_claim_clear_denied",
  ];
}

async function assertCategoryIsolation(client, otherUserId) {
  const { data, error } = await client
    .from("categories")
    .select("id")
    .eq("user_id", otherUserId);

  assertNoError(error, "reading another user's categories");
  assertNoRows(data, "another user's categories");

  return "category_select";
}

async function assertBehaviorIsolation(client, otherBehaviorId) {
  const { data, error } = await client
    .from("behaviors")
    .select("id")
    .eq("id", otherBehaviorId);

  assertNoError(error, "reading another user's behavior");
  assertNoRows(data, "another user's behavior");

  return "behavior_select";
}

async function assertBehaviorInsertCheck(client, otherUserId) {
  const { data, error } = await client
    .from("behaviors")
    .insert({
      user_id: otherUserId,
      category_id: null,
      title: "RLS smoke forbidden insert",
      description: null,
      recurrence_rule: {
        frequency: "daily",
        interval: 1,
      },
      scheduled_time: "10:00",
      timezone: "America/New_York",
      browser_reminder_enabled: true,
      email_reminder_enabled: false,
      reminder_offset_minutes: 0,
      active: true,
      archived_at: null,
    })
    .select("id");

  if (!error) {
    throw new Error(
      `RLS allowed inserting a behavior for another user: ${JSON.stringify(data)}`,
    );
  }

  return "behavior_insert_check";
}

async function assertBehaviorUpdateIsolation(client, otherBehaviorId) {
  const { data, error } = await client
    .from("behaviors")
    .update({ title: "RLS smoke forbidden update" })
    .eq("id", otherBehaviorId)
    .select("id");

  if (!error) {
    throw new Error(
      `Authenticated direct behavior update was not denied: ${JSON.stringify(data)}`,
    );
  }

  return "behavior_direct_update_denied";
}

async function assertOwnBehaviorVisible(client, behaviorId) {
  const { data, error } = await client
    .from("behaviors")
    .select("id")
    .eq("id", behaviorId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`RLS hid the signed-in user's own behavior: ${error?.message}`);
  }

  return "own_behavior_select";
}

function createSupabase(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function assertNoError(error, action) {
  if (error) {
    throw new Error(`Unexpected error while ${action}: ${error.message}`);
  }
}

function assertNoRows(data, label) {
  if (data && data.length > 0) {
    throw new Error(`RLS exposed ${label}.`);
  }
}

function normalizeEnvValue(value) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseEnvironmentValue(rawValue) {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue.slice(1, -1);
    }
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  return rawValue;
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "::1", "localhost"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return env;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      `${basename(process.argv[1])} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
