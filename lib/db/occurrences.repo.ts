import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";
import type { OccurrenceGenerationPlan } from "@/lib/resolvers/occurrence.resolver";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import type {
  NewOccurrence,
  Occurrence,
  OccurrenceUpdate,
} from "@/lib/types/database";
import type { ScheduleKind } from "@/lib/types/schedule";

export async function listBehaviorOccurrencesFrom(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
  scheduledFrom: string,
): Promise<Occurrence[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_behavior_occurrences_from",
      counts: (occurrences) => ({ occurrences: occurrences.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select("*")
        .eq("user_id", userId)
        .eq("behavior_id", behaviorId)
        .gte("scheduled_for", scheduledFrom)
        .order("scheduled_for", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function listUnresolvedOccurrencesBeforeLocalDate(
  supabase: AppSupabaseClient,
  userId: string,
  localDate: string,
): Promise<Occurrence[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_unresolved_occurrences_before_local_date",
      counts: (occurrences) => ({ occurrences: occurrences.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "unresolved")
        .lt("local_date", localDate)
        .order("local_date", { ascending: false })
        .order("scheduled_for", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function listResolvedOccurrencesBeforeLocalDateMarkedBetween(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    localDate: string;
    statusMarkedFrom: string;
    statusMarkedBefore: string;
  },
): Promise<Occurrence[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_resolved_occurrences_before_local_date_marked_between",
      counts: (occurrences) => ({ occurrences: occurrences.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select("*")
        .eq("user_id", input.userId)
        .in("status", ["completed", "not_completed"])
        .lt("local_date", input.localDate)
        .gte("status_marked_at", input.statusMarkedFrom)
        .lt("status_marked_at", input.statusMarkedBefore)
        .order("local_date", { ascending: false })
        .order("scheduled_for", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function listOccurrencesBetweenLocalDates(
  supabase: AppSupabaseClient,
  userId: string,
  startLocalDate: string,
  endLocalDate: string,
): Promise<Occurrence[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_occurrences_between_local_dates",
      counts: (occurrences) => ({ occurrences: occurrences.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select("*")
        .eq("user_id", userId)
        .gte("local_date", startLocalDate)
        .lte("local_date", endLocalDate)
        .order("local_date", { ascending: true })
        .order("scheduled_for", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function listUserOccurrences(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<Occurrence[]> {
  return readAllPostgrestRows<Occurrence>({
    label: "User occurrences",
    getRowKey: (occurrence) => occurrence.id,
    createQuery: () =>
      supabase
        .from("occurrences")
        .select("*")
        .eq("user_id", userId)
        .order("local_date", { ascending: true })
        .order("scheduled_for", { ascending: true })
        .order("id", { ascending: true }),
  });
}

export async function getOccurrenceById(
  supabase: AppSupabaseClient,
  userId: string,
  occurrenceId: string,
): Promise<Occurrence | null> {
  const { data, error } = await supabase
    .from("occurrences")
    .select("*")
    .eq("user_id", userId)
    .eq("id", occurrenceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export type OccurrenceWithBehaviorTimezone = Occurrence & {
  behavior: { timezone: string | null } | null;
};

export async function getOccurrenceWithBehaviorTimezoneById(
  supabase: AppSupabaseClient,
  userId: string,
  occurrenceId: string,
): Promise<OccurrenceWithBehaviorTimezone | null> {
  const { data, error } = await supabase
    .from("occurrences")
    .select("*, behavior:behaviors!occurrences_behavior_id_fkey(timezone)")
    .eq("user_id", userId)
    .eq("id", occurrenceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? (data as unknown as OccurrenceWithBehaviorTimezone) : null;
}

export async function getOccurrenceByScheduleIdentity(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    behaviorId: string;
    localDate: string;
    scheduleKind: ScheduleKind;
    scheduleStartTime: string;
    scheduleEndTime: string | null;
  },
): Promise<Occurrence | null> {
  const { data, error } = await supabase
    .from("occurrences")
    .select("*")
    .eq("user_id", input.userId)
    .eq("behavior_id", input.behaviorId)
    .eq("local_date", input.localDate)
    .eq("schedule_start_time", input.scheduleStartTime)
    .eq(
      "schedule_range_identity",
      resolveScheduleRangeIdentity(input.scheduleKind, input.scheduleEndTime),
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function createOccurrenceForImport(
  supabase: AppSupabaseClient,
  occurrence: NewOccurrence,
): Promise<Occurrence> {
  const { data, error } = await supabase
    .from("occurrences")
    .insert(occurrence)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function applyOccurrenceGenerationPlan(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    behaviorId: string;
    expectedConfigurationEventId: string;
    now: string;
    plan: OccurrenceGenerationPlan;
  },
): Promise<{
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
}> {
  const { data, error } = await supabase.rpc(
    "apply_occurrence_generation_plan",
    {
      target_user_id: input.userId,
      target_behavior_id: input.behaviorId,
      expected_configuration_event_id:
        input.expectedConfigurationEventId,
      plan_now: input.now,
      occurrence_inserts: input.plan.create.map((occurrence) => ({
        scheduled_for: occurrence.scheduledFor,
        local_date: occurrence.localDate,
        behavior_schedule_slot_id: occurrence.scheduleSlotId,
        behavior_configuration_event_id:
          occurrence.behaviorConfigurationEventId,
        schedule_kind: occurrence.scheduleKind,
        schedule_preset: occurrence.schedulePreset,
        schedule_start_time: occurrence.scheduleStartTime,
        schedule_end_time: occurrence.scheduleEndTime,
      })) as Json,
      occurrence_updates: input.plan.updateUnresolved.map((occurrence) => ({
        id: occurrence.id,
        previous_scheduled_for: occurrence.previousScheduledFor,
        scheduled_for: occurrence.scheduledFor,
        local_date: occurrence.localDate,
        behavior_schedule_slot_id: occurrence.scheduleSlotId,
        behavior_configuration_event_id:
          occurrence.behaviorConfigurationEventId,
        schedule_kind: occurrence.scheduleKind,
        schedule_preset: occurrence.schedulePreset,
        schedule_start_time: occurrence.scheduleStartTime,
        schedule_end_time: occurrence.scheduleEndTime,
      })) as Json,
      occurrence_deletes: input.plan.deleteUnresolved.map((occurrence) => ({
        id: occurrence.id,
        scheduled_for: occurrence.scheduledFor,
        local_date: occurrence.localDate,
        behavior_schedule_slot_id: occurrence.scheduleSlotId,
        behavior_configuration_event_id:
          occurrence.behaviorConfigurationEventId,
        schedule_kind: occurrence.scheduleKind,
        schedule_preset: occurrence.schedulePreset,
        schedule_start_time: occurrence.scheduleStartTime,
        schedule_end_time: occurrence.scheduleEndTime,
      })) as Json,
    },
  );

  if (error) {
    throw error;
  }

  const result = data as Record<string, unknown> | null;

  return {
    insertedCount: readInteger(result?.inserted_count),
    updatedCount: readInteger(result?.updated_count),
    deletedCount: readInteger(result?.deleted_count),
  };
}

export async function updateOccurrenceById(
  supabase: AppSupabaseClient,
  userId: string,
  occurrenceId: string,
  occurrence: OccurrenceUpdate,
): Promise<Occurrence | null> {
  const { data, error } = await supabase
    .from("occurrences")
    .update(occurrence)
    .eq("user_id", userId)
    .eq("id", occurrenceId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function updateOccurrenceNoteIfExpected(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    occurrenceId: string;
    expectedNote: string | null;
    note: string | null;
    usedShortcut?: boolean;
  },
): Promise<Occurrence | null> {
  if (input.usedShortcut) {
    const { data, error } = await supabase
      .rpc("update_occurrence_note_with_shortcut", {
        target_occurrence_id: input.occurrenceId,
        expected_note: input.expectedNote as unknown as string,
        next_note: input.note as unknown as string,
        used_shortcut: true,
      })
      .maybeSingle();

    if (error) throw error;
    return data ?? null;
  }

  let query = supabase
    .from("occurrences")
    .update({ note: input.note })
    .eq("user_id", input.userId)
    .eq("id", input.occurrenceId);

  query = input.expectedNote === null
    ? query.is("note", null)
    : query.eq("note", input.expectedNote);

  const { data, error } = await query.select("*").maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function updateOccurrenceNoteIfEmpty(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    occurrenceId: string;
    note: string;
  },
): Promise<Occurrence | null> {
  const occurrence = await getOccurrenceById(
    supabase,
    input.userId,
    input.occurrenceId,
  );

  if (!occurrence || !isEmptyOccurrenceNote(occurrence.note)) {
    return null;
  }

  return updateOccurrenceById(supabase, input.userId, input.occurrenceId, {
    note: input.note,
  });
}

function isEmptyOccurrenceNote(note: string | null): boolean {
  return (note?.trim() ?? "").length === 0;
}

function resolveScheduleRangeIdentity(
  kind: ScheduleKind,
  endTime: string | null,
): number {
  if (kind === "exact") {
    return -1;
  }

  const match = endTime?.match(/^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,6})?))?$/);

  if (!match) {
    throw new Error("Range occurrence identity requires a valid end time.");
  }

  return Math.round(
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)) *
      1_000_000,
  );
}

function readInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}
