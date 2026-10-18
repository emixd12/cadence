import type { AppSupabaseClient } from "./behaviors.repo";
import { readAllPostgrestRows } from "./paginated-read";
import type { Category, Occurrence } from "@/lib/types/database";

/** Full pagination avoids silently inheriting PostgREST's 1,000-row response cap. */
export function readIntegrationOccurrences(supabase: AppSupabaseClient, userId: string, range?: {
  startLocalDate: string; endLocalDate: string;
}): Promise<Occurrence[]> {
  return readAllPostgrestRows<Occurrence>({
    label: "Integration occurrences", getRowKey: (row) => row.id,
    createQuery: () => {
      let query = supabase.from("occurrences").select("*").eq("user_id", userId);
      if (range) query = query.gte("local_date", range.startLocalDate).lte("local_date", range.endLocalDate);
      return query.order("local_date").order("scheduled_for").order("id");
    },
  });
}

export function readIntegrationCategories(supabase: AppSupabaseClient, userId: string): Promise<Category[]> {
  return readAllPostgrestRows<Category>({
    label: "Integration categories", getRowKey: (row) => row.id,
    createQuery: () => supabase.from("categories").select("*").eq("user_id", userId)
      .order("sort_order").order("name").order("id"),
  });
}
