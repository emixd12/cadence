import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import type {
  Behavior,
  BehaviorSchedule,
  BehaviorScheduleSlot,
  BehaviorUpdate,
  Category,
} from "@/lib/types/database";

export type AppSupabaseClient = SupabaseClient<Database>;

export type BehaviorWithCategory = Behavior & {
  category: Pick<Category, "id" | "name"> | null;
  schedules?: BehaviorScheduleWithSlots[];
  schedule_slots: BehaviorScheduleSlot[];
};

export type BehaviorScheduleWithSlots = BehaviorSchedule & {
  schedule_slots: BehaviorScheduleSlot[];
};

const BEHAVIOR_WITH_CATEGORY_SELECT =
  "*, category:categories!behaviors_category_id_fkey(id, name), schedules:behavior_schedules!behavior_schedules_behavior_owner_fkey(*, schedule_slots:behavior_schedule_slots!behavior_schedule_slots_schedule_owner_fkey(*)), schedule_slots:behavior_schedule_slots!behavior_schedule_slots_behavior_owner_fkey(*)";
const BEHAVIOR_WITH_CATEGORY_ONLY_SELECT =
  "*, category:categories!behaviors_category_id_fkey(id, name)";

export async function listBehaviorCategories(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<Category[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_behavior_categories",
      counts: (categories) => ({ categories: categories.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function listUserBehaviors(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<BehaviorWithCategory[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_user_behaviors",
      counts: (behaviors) => ({
        behaviors: behaviors.length,
        active_behaviors: behaviors.filter((behavior) => behavior.active).length,
        schedule_slots: behaviors.reduce(
          (sum, behavior) => sum + behavior.schedule_slots.length,
          0,
        ),
        schedules: behaviors.reduce(
          (sum, behavior) => sum + (behavior.schedules?.length ?? 0),
          0,
        ),
      }),
    },
    async () => {
      const [behaviorRows, schedules, scheduleSlots] = await Promise.all([
        readAllPostgrestRows<
          Omit<BehaviorWithCategory, "schedules" | "schedule_slots">
        >({
          label: "User behaviors",
          getRowKey: (behavior) => behavior.id,
          createQuery: () =>
            supabase
              .from("behaviors")
              .select(BEHAVIOR_WITH_CATEGORY_ONLY_SELECT)
              .eq("user_id", userId)
              .order("active", { ascending: false })
              .order("scheduled_time", { ascending: true })
              .order("title", { ascending: true })
              .order("id", { ascending: true }) as never,
        }),
        readAllPostgrestRows<BehaviorSchedule>({
          label: "User behavior schedules",
          getRowKey: (schedule) => schedule.id,
          createQuery: () =>
            supabase
              .from("behavior_schedules")
              .select("*")
              .eq("user_id", userId)
              .order("behavior_id", { ascending: true })
              .order("sort_order", { ascending: true })
              .order("id", { ascending: true }),
        }),
        readAllPostgrestRows<BehaviorScheduleSlot>({
          label: "User behavior schedule slots",
          getRowKey: (slot) => slot.id,
          createQuery: () =>
            supabase
              .from("behavior_schedule_slots")
              .select("*")
              .eq("user_id", userId)
              .order("behavior_id", { ascending: true })
              .order("sort_order", { ascending: true })
              .order("start_time", { ascending: true })
              .order("id", { ascending: true }),
        }),
      ]);
      const slotsByBehaviorId = groupBy(scheduleSlots, (slot) => slot.behavior_id);
      const slotsByScheduleId = groupBy(
        scheduleSlots.filter((slot) => slot.behavior_schedule_id !== null),
        (slot) => slot.behavior_schedule_id as string,
      );
      const schedulesByBehaviorId = groupBy(
        schedules.map((schedule) => ({
          ...schedule,
          schedule_slots: slotsByScheduleId.get(schedule.id) ?? [],
        })),
        (schedule) => schedule.behavior_id,
      );
      const data: BehaviorWithCategory[] = behaviorRows.map((behavior) => ({
        ...behavior,
        schedules: schedulesByBehaviorId.get(behavior.id) ?? [],
        schedule_slots: slotsByBehaviorId.get(behavior.id) ?? [],
      }));

      return sortBehaviorScheduleSlots(data);
    },
  );
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    const group = grouped.get(key);

    if (group) {
      group.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }

  return grouped;
}

export async function getBehaviorById(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
): Promise<BehaviorWithCategory | null> {
  return measurePerformanceSpan(
    {
      span: "db.get_behavior_by_id",
      counts: (behavior) => ({
        behaviors: behavior ? 1 : 0,
        schedule_slots: behavior?.schedule_slots.length ?? 0,
        schedules: behavior?.schedules?.length ?? 0,
      }),
    },
    async () => {
      const { data, error } = await supabase
        .from("behaviors")
        .select(BEHAVIOR_WITH_CATEGORY_SELECT)
        .eq("user_id", userId)
        .eq("id", behaviorId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data
        ? sortBehaviorScheduleSlots([data as unknown as BehaviorWithCategory])[0]
        : null;
    },
  );
}

export async function getProfileTimezone(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<string | null> {
  return measurePerformanceSpan(
    {
      span: "db.get_profile_timezone",
      counts: (timezone) => ({ profiles: timezone ? 1 : 0 }),
    },
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data?.timezone ?? null;
    },
  );
}

export async function updateBehavior(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
  behavior: BehaviorUpdate,
): Promise<BehaviorWithCategory | null> {
  const { data, error } = await supabase
    .from("behaviors")
    .update(behavior)
    .eq("user_id", userId)
    .eq("id", behaviorId)
    .select(BEHAVIOR_WITH_CATEGORY_SELECT)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? sortBehaviorScheduleSlots([data as unknown as BehaviorWithCategory])[0]
    : null;
}

export async function listBehaviorScheduleSlots(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
): Promise<BehaviorScheduleSlot[]> {
  return measurePerformanceSpan(
    {
      span: "db.list_behavior_schedule_slots",
      counts: (slots) => ({ schedule_slots: slots.length }),
    },
    async () => {
      const { data, error } = await supabase
        .from("behavior_schedule_slots")
        .select("*")
        .eq("user_id", userId)
        .eq("behavior_id", behaviorId)
        .order("sort_order", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  );
}

export async function getBehaviorScheduleSlotById(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    scheduleSlotId: string;
  },
): Promise<BehaviorScheduleSlot | null> {
  const { data, error } = await supabase
    .from("behavior_schedule_slots")
    .select("*")
    .eq("user_id", input.userId)
    .eq("id", input.scheduleSlotId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

function sortBehaviorScheduleSlots(
  behaviors: BehaviorWithCategory[],
): BehaviorWithCategory[] {
  return behaviors.map((behavior) => ({
    ...behavior,
    schedules: sortBehaviorSchedules(behavior.schedules ?? []),
    schedule_slots: sortScheduleSlots(behavior.schedule_slots ?? []),
  }));
}

function sortBehaviorSchedules(
  schedules: BehaviorScheduleWithSlots[],
): BehaviorScheduleWithSlots[] {
  return [...schedules]
    .sort((left, right) => {
      const sortComparison = left.sort_order - right.sort_order;

      if (sortComparison !== 0) {
        return sortComparison;
      }

      return left.id.localeCompare(right.id);
    })
    .map((schedule) => ({
      ...schedule,
      schedule_slots: sortScheduleSlots(schedule.schedule_slots ?? []),
    }));
}

function sortScheduleSlots(
  slots: BehaviorScheduleSlot[],
): BehaviorScheduleSlot[] {
  return [...slots].sort((left, right) => {
    const sortComparison = left.sort_order - right.sort_order;

    if (sortComparison !== 0) {
      return sortComparison;
    }

    return left.start_time.localeCompare(right.start_time);
  });
}
