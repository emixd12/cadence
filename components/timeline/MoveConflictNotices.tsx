"use client";

import { useState } from "react";
import type { TimelineOccurrenceView, TimelineView } from "@cadence/core/types/timeline";
import { useOccurrenceMoves } from "./OccurrenceMoves";

export type MoveConflictNotice = Readonly<{ id: string; occurrenceId: string; conflictingOccurrenceId: string | null }>;

const LINK = "-my-2 inline-block py-2 font-bold underline underline-offset-2 hover:text-foreground disabled:opacity-60";

/**
 * Advisor plan, Phase 2 (data model, section 5): a schedule edit kept today's move,
 * and the moved time now overlaps another item. One plain line per notice with
 * Yes / No / Other time as text links. Not an alert: nothing failed.
 */
export function MoveConflictNotices({ conflicts, timeline }: Readonly<{ conflicts: readonly MoveConflictNotice[]; timeline: TimelineView }>) {
  const moves = useOccurrenceMoves();
  const [answered, setAnswered] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  if (!moves) return null;
  const today = timeline.daySections.find((section) => section.localDate === timeline.todayLocalDate);
  const byId = new Map<string, TimelineOccurrenceView>((today?.occurrences ?? []).map((occurrence) => [occurrence.id, occurrence]));
  const open = conflicts.flatMap((conflict) => {
    const occurrence = byId.get(conflict.occurrenceId);
    return occurrence && occurrence.movedFromLabel && !answered.includes(conflict.id) && moves.canMove(occurrence)
      ? [{ conflict, occurrence, other: conflict.conflictingOccurrenceId ? byId.get(conflict.conflictingOccurrenceId) : undefined }]
      : [];
  });
  if (open.length === 0) return null;
  const answer = (id: string) => setAnswered((ids) => [...ids, id]);

  return (
    <div role="status" className="grid gap-2 border-b border-line py-3 text-base leading-6" data-move-conflicts>
      {open.map(({ conflict, occurrence, other }) => (
        <p key={conflict.id} data-move-conflict={conflict.id}>
          Your schedule changed, and {occurrence.title} at {occurrence.scheduledTimeLabel} today now overlaps{" "}
          {other ? `${other.title} at ${other.scheduledTimeLabel}` : "another item"}. Keep {occurrence.title} at {occurrence.scheduledTimeLabel}?{" "}
          <button type="button" className={LINK} onClick={async () => {
            setFailed(null);
            if (await moves.keep(conflict.id)) answer(conflict.id);
            else setFailed(conflict.id);
          }}>Yes</button>
          {" · "}
          <button type="button" className={LINK} disabled={moves.pendingId === occurrence.id} onClick={() => {
            answer(conflict.id);
            void moves.undo(occurrence);
          }} aria-label={`No, move ${occurrence.title} back to ${occurrence.movedFromLabel}`}>No</button>
          {" · "}
          <button type="button" className={LINK} onClick={() => {
            answer(conflict.id);
            moves.openMenu(occurrence.id);
          }}>Other time</button>
          {failed === conflict.id ? <span className="block text-sm text-muted-readable">That answer was not saved. Try again.</span> : null}
        </p>
      ))}
    </div>
  );
}
