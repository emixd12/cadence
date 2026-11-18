import type { ExportOccurrenceMoveInput } from "@cadence/core/types/export";
import type { AppSupabaseClient } from "./behaviors.repo";
import { readAllPostgrestRows } from "./paginated-read";

type MoveRow = Readonly<{
  id: string; occurrence_id: string; behavior_id: string; local_date: string; timezone: string; kind: string;
  from_start_at: string; from_end_at: string; from_planned: boolean; to_start_at: string; to_end_at: string;
  to_planned: boolean; duration_source: string; chain_position: number; revises_move_id: string | null;
  reason: string | null; source: string; created_at: string;
}>;

const MOVE_COLUMNS = "id, occurrence_id, behavior_id, local_date, timezone, kind, from_start_at, from_end_at, from_planned, to_start_at, to_end_at, to_planned, duration_source, chain_position, revises_move_id, reason, source, created_at" as const;

/** Per-day moves in a local date range, with the reason chip a person tapped, for export. */
export async function listOccurrenceMovesForExport(
  supabase: AppSupabaseClient, userId: string, startLocalDate: string | null, endLocalDate: string,
): Promise<ExportOccurrenceMoveInput[]> {
  const [moves, reasons] = await Promise.all([
    readAllPostgrestRows<MoveRow>({
      label: "Export occurrence moves", getRowKey: (row) => row.id,
      createQuery: () => {
        let query = supabase.from("occurrence_moves").select(MOVE_COLUMNS).eq("user_id", userId).lte("local_date", endLocalDate);
        if (startLocalDate) query = query.gte("local_date", startLocalDate);
        return query.order("created_at").order("id");
      },
    }),
    readAllPostgrestRows<{ move_id: string; person_reason: string }>({
      label: "Export occurrence move reasons", getRowKey: (row) => row.move_id,
      createQuery: () => supabase.from("occurrence_move_reasons").select("move_id, person_reason").eq("user_id", userId).order("move_id"),
    }),
  ]);
  const reasonByMove = new Map(reasons.map((row) => [row.move_id, row.person_reason]));
  return moves.map((row) => ({
    id: row.id, occurrenceId: row.occurrence_id, behaviorId: row.behavior_id, localDate: row.local_date,
    timezone: row.timezone, kind: row.kind as ExportOccurrenceMoveInput["kind"],
    fromStartAt: row.from_start_at, fromEndAt: row.from_end_at, fromPlanned: row.from_planned,
    toStartAt: row.to_start_at, toEndAt: row.to_end_at, toPlanned: row.to_planned,
    durationSource: row.duration_source, chainPosition: row.chain_position, revisesMoveId: row.revises_move_id,
    reason: row.reason, personReason: reasonByMove.get(row.id) ?? null, source: row.source, createdAt: row.created_at,
  }));
}
