"use client";

import { Temporal } from "@js-temporal/polyfill";
import { createContext, Fragment, useContext, useId, useState, type ReactNode } from "react";
import { noticeText } from "@cadence/core/notices";
import { MARK_DETAIL_PROMPTS, markDetailPromptPicked, NOT_DONE_REASONS, type MarkDetailPromptSettings, type NotDoneReason } from "@cadence/core/resolvers/status.resolver";
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
 *
 * Ticket 360 (D33): a third line after a Completed mark, "Done alongside other things?
 * Yes · No", while the Behavior's alongside question is open (the row's
 * `alongsideQuestion`, from `alongsideQuestionOpen`). It shows only when the page passes
 * an `alongside` action and no "Done at" line shows: a row shows one line at a time and
 * "Done at" keeps priority. The answer is the Behavior's setting, not this mark's.
 */

export type MarkDetailState =
  | Readonly<{ status: "saved" }>
  | Readonly<{ status: "refused" | "error"; message: string }>;

export type OccurrenceMarkDetailActions = Readonly<{
  /** `doneAt` is a UTC instant. */
  doneAt(input: Readonly<{ occurrenceId: string; doneAt: string }>): Promise<MarkDetailState>;
  notDoneReason(input: Readonly<{ occurrenceId: string; reason: NotDoneReason }>): Promise<MarkDetailState>;
  /**
   * Ticket 360: the answer to "Done alongside other things?", written to the Behavior's
   * alongside setting. Optional: without it no row asks (the Mac until Ticket 363).
   */
  alongside?(input: Readonly<{ occurrenceId: string; behaviorId: string; alongside: boolean }>): Promise<MarkDetailState>;
}>;

export const NOT_DONE_REASON_LABELS: Readonly<Record<NotDoneReason, string>> = {
  no_time: "No time",
  forgot: "Forgot",
  low_energy: "Low energy",
  away: "Away",
  chose_not_to: "Chose not to",
};

type MarkDetailsContextValue = Readonly<{ actions: OccurrenceMarkDetailActions; timezone: string; prompts: MarkDetailPromptSettings }>;
const MarkDetailsContext = createContext<MarkDetailsContextValue | null>(null);

/** `prompts` defaults to `MARK_DETAIL_PROMPTS`; the design bench and tests pass their own. */
export function OccurrenceMarkDetailsProvider({ actions, timezone, prompts = MARK_DETAIL_PROMPTS, children }: Readonly<{
  actions: OccurrenceMarkDetailActions;
  timezone: string;
  prompts?: MarkDetailPromptSettings;
  children: ReactNode;
}>) {
  return <MarkDetailsContext.Provider value={{ actions, timezone, prompts }}>{children}</MarkDetailsContext.Provider>;
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
  markedAt: string, timezone: string, lateAfterMinutes: number = MARK_DETAIL_PROMPTS.doneAt.lateAfterMinutes): Readonly<{ setTime: string | null; setTimeLabel: string | null }> | null {
  const marked = Temporal.Instant.from(markedAt);
  const range = occurrence.scheduleKind === "range";
  let due = Temporal.Instant.from(occurrence.scheduledFor);
  if (range && occurrence.scheduleEndTime) {
    try {
      due = Temporal.PlainDate.from(occurrence.localDate)
        .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(occurrence.scheduleEndTime) }).toInstant();
    } catch { /* keep the start */ }
  }
  if (Temporal.Instant.compare(marked, due.add({ minutes: lateAfterMinutes })) < 0) return null;
  return range ? { setTime: null, setTimeLabel: null } : { setTime: occurrence.scheduledFor, setTimeLabel: occurrence.scheduledTimeLabel };
}

const LINK = "-my-2 inline-block py-2 underline underline-offset-2 disabled:opacity-60";

/**
 * Taps joined by " · ". Each tap keeps its trailing dot on its own piece, and the space
 * between pieces is the only place a narrow row breaks, so a wrapped line never starts
 * with a dot.
 */
function choices(items: readonly ReactNode[]): ReactNode {
  return items.map((item, index) => (
    <Fragment key={index}>
      {index ? " " : null}
      <span className="whitespace-nowrap">{item}{index < items.length - 1 ? " ·" : null}</span>
    </Fragment>
  ));
}

type MarkDetailParts = Readonly<{
  /** Sits right after the title inside the row's summary; wraps under it only when the row has no room. */
  inline: ReactNode;
  /** Only the Other time field, under the summary so typing never opens or closes the row. */
  below: ReactNode;
}>;

const NONE: MarkDetailParts = { inline: null, below: null };

/**
 * The words and taps a just-marked row shows. `inline` goes next to the title: a tap on
 * it cancels the click's default so the row does not open or close. `toneClass` is the
 * row's own text color, so it reads on the Completed and Not Completed fills.
 */
export function useOccurrenceMarkDetailParts({ occurrence, justMarked, toneClass }: Readonly<{
  occurrence: TimelineOccurrenceView;
  justMarked: JustMarked | null;
  toneClass: string;
}>): MarkDetailParts {
  const context = useOccurrenceMarkDetails();
  const formId = useId();
  const [phase, setPhase] = useState<Readonly<{ key: string; state: "open" | "other" | "pending" | "dismissed" } | { key: string; state: "saved"; outcome: string } | { key: string; state: "refused"; message: string }>>({ key: "", state: "open" });
  const [otherTime, setOtherTime] = useState("");
  if (!context || !justMarked || occurrence.status !== justMarked.status) return NONE;
  const key = `${occurrence.id}:${justMarked.status}:${justMarked.at}`;
  const current = phase.key === key ? phase : { key, state: "open" as const };
  if (current.state === "dismissed") return NONE;

  const run = async (save: () => Promise<MarkDetailState>, outcome: string) => {
    setPhase({ key, state: "pending" });
    const result = await save();
    setPhase(result.status === "saved" ? { key, state: "saved", outcome } : { key, state: "refused", message: result.message });
  };
  const timeLabel = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(context.timezone)
    .toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const inlineClass = `timeline-occurrence-mark-detail min-w-0 text-xs font-normal leading-5 ${toneClass}`;
  const inline = (detail: string, children: ReactNode, extra: Readonly<{ italic?: boolean; role?: "status" | "alert" }> = {}) => (
    <span className={`${inlineClass}${extra.italic ? " italic" : ""}`} data-mark-detail={detail} role={extra.role}
      // Inside the summary: keep a tap here from opening or closing the row.
      onClick={(event) => event.preventDefault()}>{children}</span>
  );

  if (current.state === "saved") return { inline: inline("saved", current.outcome, { italic: true, role: "status" }), below: null };
  if (current.state === "refused") return { inline: inline("refused", `Not changed. ${current.message}`, { role: "alert" }), below: null };
  const pending = current.state === "pending";

  if (justMarked.status === "not_completed") {
    if (!markDetailPromptPicked("not_done_reason", occurrence.id, occurrence.localDate, context.prompts.notDoneReason.share)) return NONE;
    return {
      inline: inline("reasons", <>
        {"Why? "}
        {choices(NOT_DONE_REASONS.map((reason) => (
          <button key={reason} type="button" className={LINK} disabled={pending} data-not-done-reason={reason}
            onClick={() => {
              void run(() => context.actions.notDoneReason({ occurrenceId: occurrence.id, reason }), `Reason noted: ${NOT_DONE_REASON_LABELS[reason]}.`);
            }}>{NOT_DONE_REASON_LABELS[reason]}</button>
        )))}
      </>),
      below: null,
    };
  }

  const offer = lateMarkOffer(occurrence, justMarked.at, context.timezone, context.prompts.doneAt.lateAfterMinutes);
  if (!offer || !markDetailPromptPicked("done_at", occurrence.id, occurrence.localDate, context.prompts.doneAt.share)) {
    // Ticket 360: the alongside question only where no "Done at" line shows.
    const answerAlongside = context.actions.alongside;
    const alongsideShare = (context.prompts.alongside ?? MARK_DETAIL_PROMPTS.alongside).share;
    if (!occurrence.alongsideQuestion || !answerAlongside
      || !markDetailPromptPicked("alongside", occurrence.id, occurrence.localDate, alongsideShare)) return NONE;
    const answer = (alongside: boolean) => void run(
      () => answerAlongside({ occurrenceId: occurrence.id, behaviorId: occurrence.behaviorId, alongside }),
      noticeText("alongside.answer-saved", { answer: alongside ? "yes" : "no" }));
    return {
      inline: inline("alongside", <>
        {"Done alongside other things? "}
        {choices([
          <button key="yes" type="button" className={LINK} disabled={pending} data-alongside-answer="yes" onClick={() => answer(true)}>Yes</button>,
          <button key="no" type="button" className={LINK} disabled={pending} data-alongside-answer="no" onClick={() => answer(false)}>No</button>,
        ])}
      </>),
      below: null,
    };
  }
  const saveAt = (instant: string) => run(() => context.actions.doneAt({ occurrenceId: occurrence.id, doneAt: instant }), `Saved as done at ${timeLabel(instant)}.`);

  if (current.state === "other") {
    return {
      inline: null,
      below: (
        <form className={`timeline-occurrence-mark-detail -mt-2 flex flex-wrap items-center gap-x-2 px-3 pb-2.5 text-xs font-normal leading-5 sm:pl-28 sm:pr-4 ${toneClass}`}
          data-mark-detail="other-time"
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
      ),
    };
  }

  return {
    inline: inline("done-at", <>
      {offer.setTime && offer.setTimeLabel ? null : "Done earlier? "}
      {choices([
        ...(offer.setTime && offer.setTimeLabel ? [
          <button key="set-time" type="button" className={LINK} disabled={pending} data-done-at="set-time"
            onClick={() => void saveAt(offer.setTime!)}>Done at {offer.setTimeLabel}</button>,
        ] : []),
        <button key="just-now" type="button" className={LINK} disabled={pending} data-done-at="just-now"
          onClick={() => setPhase({ key, state: "dismissed" })}>Just now</button>,
        <button key="other-time" type="button" className={LINK} disabled={pending} data-done-at="other-time"
          onClick={() => setPhase({ key, state: "other" })}>Other time</button>,
      ])}
    </>),
    below: null,
  };
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
