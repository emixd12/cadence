"use client";

import { Temporal } from "@js-temporal/polyfill";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { LATE_MARK_THRESHOLD_MINUTES, NOT_DONE_REASONS, type NotDoneReason } from "@cadence/core/resolvers/status.resolver";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";

/**
 * Advisor plan Phase 4, workstream 4G (Emi, D8): two optional lines a row shows right
 * after the person marks it.
 *
 * - Completed well after its set time: "Done at 9:00 AM · Just now · Other time". One
 *   tap says when it was really done; the mark keeps its tap time.
 * - Not Completed: "Why? No time · Forgot · Low energy · Away · Chose not to".
 *
 * Both are never required and need no dialog. The page passes the actions in: the web
 * its server actions, the Mac its local store, the design bench fakes. Without a
 * provider (an old caller) the rows show nothing new.
 */

export type MarkDetailState =
  | Readonly<{ status: "saved" }>
  | Readonly<{ status: "refused" | "error"; message: string }>;

export type OccurrenceMarkDetailActions = Readonly<{
  /** `doneAt` is a UTC instant. */
  doneAt(input: Readonly<{ occurrenceId: string; doneAt: string }>): Promise<MarkDetailState>;
  notDoneReason(input: Readonly<{ occurrenceId: string; reason: NotDoneReason }>): Promise<MarkDetailState>;
}>;

export const NOT_DONE_REASON_LABELS: Readonly<Record<NotDoneReason, string>> = {
  no_time: "No time",
  forgot: "Forgot",
  low_energy: "Low energy",
  away: "Away",
  chose_not_to: "Chose not to",
};

type MarkDetailsContextValue = Readonly<{ actions: OccurrenceMarkDetailActions; timezone: string }>;
const MarkDetailsContext = createContext<MarkDetailsContextValue | null>(null);

export function OccurrenceMarkDetailsProvider({ actions, timezone, children }: Readonly<{
  actions: OccurrenceMarkDetailActions;
  timezone: string;
  children: ReactNode;
}>) {
  return <MarkDetailsContext.Provider value={{ actions, timezone }}>{children}</MarkDetailsContext.Provider>;
}

export function useOccurrenceMarkDetails(): MarkDetailsContextValue | null {
  return useContext(MarkDetailsContext);
}

/** A mark this row's person just made, held by the row so the line survives a refresh. */
export type JustMarked = Readonly<{ status: "completed" | "not_completed"; at: string }>;

/**
 * The set time a late Completed mark offers, or null when the mark is not late. A
 * range Behavior is late after its range ends and offers no set time.
 */
export function lateMarkOffer(occurrence: Pick<TimelineOccurrenceView, "scheduledFor" | "scheduledTimeLabel" | "scheduleKind" | "scheduleEndTime" | "localDate">,
  markedAt: string, timezone: string): Readonly<{ setTime: string | null; setTimeLabel: string | null }> | null {
  const marked = Temporal.Instant.from(markedAt);
  const range = occurrence.scheduleKind === "range";
  let due = Temporal.Instant.from(occurrence.scheduledFor);
  if (range && occurrence.scheduleEndTime) {
    try {
      due = Temporal.PlainDate.from(occurrence.localDate)
        .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(occurrence.scheduleEndTime) }).toInstant();
    } catch { /* keep the start */ }
  }
  if (Temporal.Instant.compare(marked, due.add({ minutes: LATE_MARK_THRESHOLD_MINUTES })) < 0) return null;
  return range ? { setTime: null, setTimeLabel: null } : { setTime: occurrence.scheduledFor, setTimeLabel: occurrence.scheduledTimeLabel };
}

const LINK = "-my-2 inline-block py-2 underline underline-offset-2 disabled:opacity-60";

/**
 * The line under the row's summary, outside it so a tap never opens or closes the row.
 * It lines up with the title. `toneClass` is the row's own text color, so it reads on
 * the Completed and Not Completed fills.
 */
export function OccurrenceMarkDetailLine({ occurrence, justMarked, toneClass }: Readonly<{
  occurrence: TimelineOccurrenceView;
  justMarked: JustMarked | null;
  toneClass: string;
}>) {
  const context = useOccurrenceMarkDetails();
  const formId = useId();
  const [phase, setPhase] = useState<Readonly<{ key: string; state: "open" | "other" | "pending" | "dismissed" } | { key: string; state: "saved"; outcome: string } | { key: string; state: "refused"; message: string }>>({ key: "", state: "open" });
  const [otherTime, setOtherTime] = useState("");
  if (!context || !justMarked || occurrence.status !== justMarked.status) return null;
  const key = `${occurrence.id}:${justMarked.status}:${justMarked.at}`;
  const current = phase.key === key ? phase : { key, state: "open" as const };
  if (current.state === "dismissed") return null;

  const run = async (save: () => Promise<MarkDetailState>, outcome: string) => {
    setPhase({ key, state: "pending" });
    const result = await save();
    setPhase(result.status === "saved" ? { key, state: "saved", outcome } : { key, state: "refused", message: result.message });
  };
  const timeLabel = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(context.timezone)
    .toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const lineClass = `timeline-occurrence-mark-detail -mt-2 px-3 pb-2.5 text-xs font-normal leading-5 sm:pl-28 sm:pr-4 ${toneClass}`;

  if (current.state === "saved") {
    return <p className={`${lineClass} italic`} data-mark-detail="saved" role="status">{current.outcome}</p>;
  }
  if (current.state === "refused") {
    return <p className={lineClass} data-mark-detail="refused" role="alert">Not changed. {current.message}</p>;
  }
  const pending = current.state === "pending";

  if (justMarked.status === "not_completed") {
    return (
      <p className={lineClass} data-mark-detail="reasons">
        <span>Why?</span>
        {NOT_DONE_REASONS.map((reason, index) => (
          <span key={reason} className="whitespace-nowrap">
            {index ? " · " : " "}
            <button type="button" className={LINK} disabled={pending} data-not-done-reason={reason}
              onClick={() => {
                void run(() => context.actions.notDoneReason({ occurrenceId: occurrence.id, reason }), `Reason noted: ${NOT_DONE_REASON_LABELS[reason]}.`);
              }}>{NOT_DONE_REASON_LABELS[reason]}</button>
          </span>
        ))}
      </p>
    );
  }

  const offer = lateMarkOffer(occurrence, justMarked.at, context.timezone);
  if (!offer) return null;
  const saveAt = (instant: string) => run(() => context.actions.doneAt({ occurrenceId: occurrence.id, doneAt: instant }), `Saved as done at ${timeLabel(instant)}.`);

  if (current.state === "other") {
    return (
      <form className={`${lineClass} flex flex-wrap items-center gap-x-2`} data-mark-detail="other-time"
        onSubmit={(event) => {
          event.preventDefault();
          const instant = localTimeToInstant(occurrence.localDate, otherTime, context.timezone);
          if (instant) void saveAt(instant);
        }}>
        <label htmlFor={`${formId}-done-at`}>Done at</label>
        <input id={`${formId}-done-at`} type="time" step={300} value={otherTime} onChange={(event) => setOtherTime(event.target.value)}
          className="min-h-8 border-0 border-b border-current bg-transparent px-1 py-0 text-xs text-current [color-scheme:light_dark]" />
        <button type="submit" className={LINK} disabled={!otherTime}>Save</button>
        <button type="button" className={LINK} onClick={() => setPhase({ key, state: "open" })}>Cancel</button>
      </form>
    );
  }

  return (
    <p className={lineClass} data-mark-detail="done-at">
      {offer.setTime && offer.setTimeLabel ? <>
        <button type="button" className={LINK} disabled={pending} data-done-at="set-time"
          onClick={() => void saveAt(offer.setTime!)}>Done at {offer.setTimeLabel}</button>
        {" · "}
      </> : <span>Done earlier? </span>}
      <button type="button" className={LINK} disabled={pending} data-done-at="just-now"
        onClick={() => setPhase({ key, state: "dismissed" })}>Just now</button>
      {" · "}
      <button type="button" className={LINK} disabled={pending} data-done-at="other-time"
        onClick={() => setPhase({ key, state: "other" })}>Other time</button>
    </p>
  );
}

/** A wall time on the item's local day, as a UTC instant; null for an unreadable time. */
export function localTimeToInstant(localDate: string, time: string, timezone: string): string | null {
  try {
    return Temporal.PlainDate.from(localDate)
      .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(time) }).toInstant().toString();
  } catch {
    return null;
  }
}
