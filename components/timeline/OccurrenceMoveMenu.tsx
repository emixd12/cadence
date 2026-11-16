"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";
import {
  FIRST_MOVE_LINE,
  MOVE_REASON_OPTIONS,
  moveTimeLabel,
  useMoveCalendarBusy,
  useOccurrenceMoves,
  wallTime,
} from "./OccurrenceMoves";

/**
 * Advisor plan, Phase 2C: the row's "Move for today" menu. Text only: free times as
 * plain links, then Other time with a time field. Picking a time moves at once; Undo
 * replaces a confirmation step.
 */

const LINK = "-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground disabled:opacity-60";

type SuggestState = Readonly<{ status: "idle" | "loading" } | { status: "ready"; starts: readonly string[] }>;

export function OccurrenceMoveMenu({ occurrence }: Readonly<{ occurrence: TimelineOccurrenceView }>) {
  const moves = useOccurrenceMoves();
  const calendarBusy = useMoveCalendarBusy();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [suggested, setSuggested] = useState<SuggestState>({ status: "idle" });
  const [otherTime, setOtherTime] = useState("");
  const [handledRequest, setHandledRequest] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const request = moves?.menuRequest;
  if (request && request.occurrenceId === occurrence.id && handledRequest !== request.key) {
    setHandledRequest(request.key);
    setOpen(true);
    setSuggested({ status: "loading" });
  }

  // Free times load each time the menu opens, so they reflect the day as it is now.
  useEffect(() => {
    if (!open || !moves || suggested.status !== "loading") return;
    let current = true;
    void moves.suggest(occurrence.id, calendarBusy).then((starts) => {
      if (current) setSuggested({ status: "ready", starts });
    });
    return () => { current = false; };
  }, [calendarBusy, moves, occurrence.id, open, suggested.status]);

  if (!moves || !moves.canMove(occurrence)) return null;
  const pending = moves.pendingId === occurrence.id;
  const moveTo = (startTime: string) => {
    // The row closes so its new time, Undo and the reasons sit together at the top.
    rootRef.current?.closest("details")?.removeAttribute("open");
    setOpen(false);
    setSuggested({ status: "idle" });
    void moves.move(occurrence, startTime, calendarBusy);
  };

  return (
    <div ref={rootRef} className="grid gap-1" data-move-menu>
      <button
        type="button"
        className={`justify-self-start text-sm font-bold leading-6 text-foreground ${LINK}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setSuggested({ status: open ? "idle" : "loading" });
          setOpen(!open);
        }}
      >Move for today</button>
      {open ? (
        <div id={menuId} className="grid gap-2 text-sm leading-6">
          <p className="text-muted-readable">
            {suggested.status === "ready" && suggested.starts.length === 0 ? "No free time found today. Pick a time." : "Free today:"}
            {suggested.status !== "ready" ? " finding times…" : null}
            {suggested.status === "ready" ? suggested.starts.map((start, index) => (
              <span key={start}>
                {index === 0 ? " " : " · "}
                <button type="button" className={`font-bold text-foreground ${LINK}`} disabled={pending} data-move-option={wallTime(start, moves.timezone)}
                  onClick={() => moveTo(wallTime(start, moves.timezone))}>{moveTimeLabel(start, moves.timezone)}</button>
              </span>
            )) : null}
          </p>
          <form
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (otherTime) moveTo(otherTime);
            }}
          >
            <label htmlFor={`${menuId}-time`} className="text-muted-readable">Other time</label>
            <input
              id={`${menuId}-time`}
              type="time"
              step={300}
              value={otherTime}
              onChange={(event) => setOtherTime(event.target.value)}
              className="min-h-9 border-0 border-b border-line bg-transparent px-1 py-0.5 text-sm text-foreground"
            />
            <button type="submit" className={`font-bold text-foreground ${LINK}`} disabled={!otherTime || pending}>Move</button>
            <button type="button" className={LINK} onClick={() => setOpen(false)}>Cancel</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The moved row's "Moved from 9:00 AM · Undo" line, inside the row's summary. The
 * Mac shows only "Moved from".
 */
export function OccurrenceMovedLine({ occurrence, toneClass }: Readonly<{ occurrence: TimelineOccurrenceView; toneClass: string }>) {
  const moves = useOccurrenceMoves();
  if (!occurrence.movedFromLabel) return null;
  const canUndo = Boolean(moves?.canMove(occurrence));
  return (
    <p className={`timeline-occurrence-moved col-start-2 min-w-0 text-xs font-normal leading-5 ${toneClass}`} data-moved-from>
      <span className="whitespace-nowrap">Moved from {occurrence.movedFromLabel}</span>
      {canUndo && moves ? <span className="whitespace-nowrap">
        {" · "}
        <button type="button" className={`font-bold ${LINK}`} disabled={moves.pendingId === occurrence.id} data-move-undo
          onClick={(event) => { stopSummary(event); void moves.undo(occurrence); }}>Undo</button>
      </span> : null}
    </p>
  );
}

/**
 * Right after a move: the one-time first-move line and the optional reasons, across
 * the row's full width under its summary, so they do not wrap beside the status
 * actions on a phone.
 */
export function OccurrenceMoveFollowUp({ occurrence }: Readonly<{ occurrence: TimelineOccurrenceView }>) {
  const moves = useOccurrenceMoves();
  const rowMove = moves?.rowMove(occurrence.id) ?? null;
  if (!moves || !rowMove || !occurrence.movedFromLabel || !moves.canMove(occurrence)) return null;
  const reasonLabel = rowMove.reason ? MOVE_REASON_OPTIONS.find((option) => option.value === rowMove.reason)?.label : null;
  return (
    <div className="grid gap-0.5 px-3 pb-2 text-xs leading-5 text-muted-readable sm:px-4">
      {rowMove.first ? <p data-first-move>{FIRST_MOVE_LINE}</p> : null}
      <p data-move-reasons>
        {reasonLabel ? <>Reason noted: {reasonLabel.toLowerCase()}</> : <>
          Why?{" "}
          {MOVE_REASON_OPTIONS.map((option, index) => (
            <span key={option.value}>
              {index ? " · " : ""}
              <button type="button" className={LINK} data-move-reason={option.value}
                onClick={() => void moves.recordReason(occurrence.id, option.value)}>{option.label}</button>
            </span>
          ))}
        </>}
      </p>
    </div>
  );
}

function stopSummary(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/** A refused move or Undo on this row, in the shared alert style. Never advice. */
export function OccurrenceMoveNotice({ occurrence }: Readonly<{ occurrence: TimelineOccurrenceView }>) {
  const moves = useOccurrenceMoves();
  const calendarBusy = useMoveCalendarBusy();
  const notice = moves?.notice(occurrence.id) ?? null;
  if (!moves || !notice) return null;
  const action = notice.moveAgain && moves.canMove(occurrence)
    ? <button type="button" className={LINK} onClick={() => { moves.clearNotice(occurrence.id); moves.openMenu(occurrence.id); }}>Move it again</button>
    : notice.alternatives.length ? <span>Free instead:{" "}
      {notice.alternatives.map((start, index) => (
        <span key={start}>
          {index ? " · " : ""}
          <button type="button" className={LINK} data-move-alternative={wallTime(start, moves.timezone)}
            onClick={() => void moves.move(occurrence, wallTime(start, moves.timezone), calendarBusy, notice.revision)}>{moveTimeLabel(start, moves.timezone)}</button>
        </span>
      ))}</span>
      : <button type="button" className={LINK} onClick={() => moves.clearNotice(occurrence.id)}>Dismiss</button>;
  return (
    <AlertNotice kind="write_refused" action={action} className="px-3 pb-3 sm:px-4">
      {notice.message}
    </AlertNotice>
  );
}
