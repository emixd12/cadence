import type { OccurrenceRecord } from "@cadence/core/data-store";
import { effectiveTimeFromMoves, type OccurrenceMoveTimeRecord } from "@cadence/core/resolvers/time.resolver";
import { localCommand } from "./local-store";

/**
 * Advisor plan, Phase 2B: the Mac reads per-day moves made elsewhere (web, Daily Brief,
 * chat, MCP). Moves arrive through account sync as read-only records; the Occurrence row
 * itself never changes. This attaches the effective time to in-memory copies with the
 * shared core rule, so every reader that asks `effectiveStartAt` sees the moved time.
 * The copies are for reading only: native writes always re-read the stored row.
 */
export function applyOccurrenceMoves<T extends OccurrenceRecord>(
  occurrences: readonly T[],
  moves: readonly OccurrenceMoveTimeRecord[],
  timezoneByBehavior: ReadonlyMap<string, string>,
): T[] {
  if (!moves.length) return [...occurrences];
  const byOccurrence = new Map<string, OccurrenceMoveTimeRecord[]>();
  for (const move of moves) {
    const group = byOccurrence.get(move.occurrence_id) ?? [];
    group.push(move);
    byOccurrence.set(move.occurrence_id, group);
  }
  return occurrences.map((occurrence) => {
    const group = byOccurrence.get(occurrence.id);
    const timezone = timezoneByBehavior.get(occurrence.behavior_id);
    if (!group || !timezone) return occurrence;
    const effective = effectiveTimeFromMoves(group, occurrence.id, timezone);
    return { ...occurrence, effective_start_at: effective?.effective_start_at ?? null, effective_end_at: effective?.effective_end_at ?? null };
  });
}

/** Reads the synced moves of these Occurrences and applies them. */
export async function withLocalMoves<T extends OccurrenceRecord>(
  profileId: string,
  occurrences: readonly T[],
  behaviors: readonly Readonly<{ id: string; timezone: string }>[],
): Promise<T[]> {
  if (!occurrences.length) return [];
  const moves = await localCommand("readOccurrenceMoves", { profileId, occurrenceIds: occurrences.map(({ id }) => id) });
  return applyOccurrenceMoves(occurrences, moves, new Map(behaviors.map((behavior) => [behavior.id, behavior.timezone])));
}
