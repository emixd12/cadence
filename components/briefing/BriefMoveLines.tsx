"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "@cadence/ui/runtime";
import type {
  BriefMoveAnswerKind,
  BriefMoveAnswerRequest,
  BriefMoveAnswerResponse,
  BriefMoveConflictLine,
  BriefMoveLine,
  BriefMoveRefusal,
  BriefMoves,
  BriefPlanningContext,
} from "@cadence/core/types/brief-moves";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import { moveTimeLabel, useOccurrenceMoves, wallTime } from "@/components/timeline/OccurrenceMoves";
import type { BriefMoveClient } from "@/lib/ui/daily-brief-moves";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";

/**
 * Advisor plan Phase 3 (3B): the brief's move lines. Each line reads like text: the
 * Behavior, "9:00 AM → 11:30 AM", a plain reason, then Yes · No · Other time as
 * underlined text links (DESIGN.md, "Daily Brief"). Answers apply at once; Yes opens
 * the shared move drawer with Undo. The server checks every answer at tap time; a
 * refusal shows in the alert style under its line. Nothing is typed except a time or
 * a length the person picks.
 */

export type BriefMoveLinesProps = Readonly<{
  moves: BriefMoves;
  client: BriefMoveClient;
  /** What the screen holds at tap time: calendar busy times and the travel-times token. */
  planningContext: () => BriefPlanningContext;
}>;

/** One short line the first time a person uses each answer (stored per browser). */
export const BRIEF_ANSWER_EXPLAINERS: Readonly<Partial<Record<BriefMoveAnswerKind, string>>> = Object.freeze({
  yes: "Yes: moves it for today only. Undo puts it back.",
  no: "No: no more suggestions for this today.",
  other_time: "Other time: moves it to the time you pick, for today only.",
  already_done: "Already did it: marks it Completed.",
  undo: "Undo: puts it back, and no more suggestions for this today.",
  accept_all: "Accept all: moves every item above for today. Undo all puts them back.",
  never_move: "The brief won’t suggest moving this again. You can change this in the Behavior’s settings.",
});

const EXPLAINED_KEY = "cadence.daily-brief.answers-explained.v1";

type LineUi = Readonly<{
  pending?: boolean;
  refusal?: BriefMoveRefusal | null;
  explainer?: string | null;
  panel?: "other_time" | "length" | null;
  /** After a move or Undo: the item's newest revision, sent with the next answer. */
  revision?: string;
  /** After a move: where the item is now. */
  movedTo?: string | null;
}>;

const LINK = "-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60";
const OPEN_STATUSES = new Set(["proposed"]);

export function BriefMoveLines({ moves: initial, client, planningContext }: BriefMoveLinesProps) {
  const refresh = useRefresh();
  const timeline = useOccurrenceMoves();
  const [moves, setMoves] = useState(initial);
  const [ui, setUi] = useState<Readonly<Record<string, LineUi>>>({});
  const [batchPending, setBatchPending] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [batchExplainer, setBatchExplainer] = useState<string | null>(null);
  const [keptConflicts, setKeptConflicts] = useState<ReadonlySet<string>>(new Set());
  // Answers read the newest lines and revisions, including from the drawer's Undo later on.
  // A Refresh or reopen remounts this component (the bubble keys it by brief), so local
  // answers never carry over to another brief.
  const movesRef = useRef(moves);
  const uiRef = useRef(ui);
  useEffect(() => {
    movesRef.current = moves;
    uiRef.current = ui;
  }, [moves, ui]);

  const patchUi = useCallback((proposalId: string, patch: LineUi) => {
    setUi((current) => ({ ...current, [proposalId]: { ...current[proposalId], ...patch } }));
  }, []);

  const replaceLine = useCallback((proposalId: string, line: BriefMoveLine | null) => {
    setMoves((current) => ({
      ...current,
      lines: line
        ? current.lines.map((existing) => existing.proposalId === proposalId ? line : existing)
        : current.lines.filter((existing) => existing.proposalId !== proposalId),
    }));
  }, []);

  // Re-check on open: lines whose time was taken after the brief was written arrive
  // already re-planned. Failures change nothing; Yes still checks again on the server.
  useEffect(() => {
    if (!client.recheck || !initial.lines.some((line) => OPEN_STATUSES.has(line.status))) return;
    const controller = new AbortController();
    const proposalIds = initial.lines.filter((line) => OPEN_STATUSES.has(line.status)).map((line) => line.proposalId);
    client.recheck({ localDate: initial.localDate, context: planningContext(), proposalIds }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        for (const entry of response.replaced) replaceLine(entry.proposalId, entry.line);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // Once per mount: the bubble remounts this component on every open and reopen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sends one answer for one line and folds the result back in. */
  const answer = useCallback(async (line: BriefMoveLine, request: BriefMoveAnswerRequest): Promise<BriefMoveAnswerResponse | null> => {
    patchUi(line.proposalId, { pending: true, refusal: null });
    try {
      const response = await client.answer(request);
      const result = response.results.find((entry) => entry.proposalId === line.proposalId) ?? response.results[0];
      if (!result) return response;
      if (result.outcome === "refused") {
        patchUi(line.proposalId, { refusal: result.refusal });
        if (result.line) replaceLine(line.proposalId, result.line);
        refresh();
        return response;
      }
      if (result.line) replaceLine(line.proposalId, result.line);
      patchUi(line.proposalId, {
        panel: null,
        explainer: firstUseExplainer(request.kind),
        ...(result.occurrence ? { revision: result.occurrence.revision, movedTo: result.occurrence.effectiveStartAt } : {}),
      });
      if (result.occurrence) refresh();
      return response;
    } catch (error) {
      patchUi(line.proposalId, { refusal: requestRefusal(error) });
      return null;
    } finally {
      patchUi(line.proposalId, { pending: false });
    }
  }, [client, patchUi, refresh, replaceLine]);

  const undo = useCallback(async (line: BriefMoveLine) => {
    const current = movesRef.current.lines.find((entry) => entry.proposalId === line.proposalId) ?? line;
    const response = await answer(current, { kind: "undo", proposalId: current.proposalId, expectedRevision: revisionAfter(current, uiRef.current), idempotencyKey: newKey() });
    if (response?.results.some((result) => result.outcome === "applied")) timeline?.dismissMoveConfirmation(current.occurrenceId);
  }, [answer, timeline]);

  /** Opens the shared drawer for a move the brief applied, with the brief's Undo. */
  const confirm = useCallback((line: BriefMoveLine, response: BriefMoveAnswerResponse) => {
    const result = response.results.find((entry) => entry.proposalId === line.proposalId);
    if (!timeline || result?.outcome !== "applied" || !result.moveId) return;
    const applied = result.line ?? line;
    const start = result.occurrence?.effectiveStartAt ?? applied.to.startAt;
    timeline.confirmBriefMove({
      occurrenceId: line.occurrenceId,
      title: line.title,
      moveId: result.moveId,
      from: moveTimeLabel(line.from.startAt, line.timezone),
      to: moveTimeLabel(start, line.timezone),
      showFirstMoveLine: response.showFirstMoveLine,
      onUndo: () => undo(applied),
    });
  }, [timeline, undo]);

  const yes = async (line: BriefMoveLine) => {
    const response = await answer(line, { kind: "yes", proposalId: line.proposalId, expectedRevision: line.expectedRevision, context: planningContext(), idempotencyKey: newKey() });
    if (response) confirm(line, response);
  };
  const otherTime = async (line: BriefMoveLine, startAt: string) => {
    const response = await answer(line, { kind: "other_time", proposalId: line.proposalId, expectedRevision: revisionAfter(line, uiRef.current), startAt, context: planningContext(), idempotencyKey: newKey() });
    if (response) confirm(line, response);
  };

  const replan = async (line: BriefMoveLine) => {
    patchUi(line.proposalId, { pending: true, refusal: null });
    try {
      const response = await client.replan({ proposalId: line.proposalId, context: planningContext() });
      if (response.line) {
        replaceLine(line.proposalId, response.line);
        setUi((current) => {
          const next = { ...current };
          delete next[line.proposalId];
          return next;
        });
      } else {
        patchUi(line.proposalId, { refusal: { reason: "no_time", message: "No other time fits today.", alternatives: [], revision: null } });
      }
    } catch (error) {
      patchUi(line.proposalId, { refusal: requestRefusal(error) });
    } finally {
      patchUi(line.proposalId, { pending: false });
    }
  };

  const changeLength = async (line: BriefMoveLine, minutes: number) => {
    patchUi(line.proposalId, { pending: true, refusal: null });
    try {
      await client.length({ behaviorId: line.behaviorId, minutes, expectedBehaviorRevision: line.behaviorRevision });
      patchUi(line.proposalId, { panel: null });
      // The line's end time used the old length; Re-plan builds it again with the new one.
      await replan(line);
    } catch (error) {
      patchUi(line.proposalId, { refusal: requestRefusal(error), pending: false });
    }
  };

  const open = moves.lines.filter((line) => OPEN_STATUSES.has(line.status));
  const shown = moves.lines.filter((line) => line.status !== "superseded" && line.status !== "withdrawn");
  const conflicts = moves.conflicts.filter((conflict) => !keptConflicts.has(conflict.conflictId));

  const acceptAll = async () => {
    if (batchPending || open.length < 2) return;
    setBatchPending(true);
    setBatchNotice(null);
    try {
      const response = await client.answer({
        kind: "accept_all",
        lines: open.map((line) => ({ proposalId: line.proposalId, expectedRevision: line.expectedRevision })),
        context: planningContext(),
        idempotencyKey: newKey(),
      });
      for (const result of response.results) {
        if (result.line) replaceLine(result.proposalId, result.line);
        if (result.outcome === "refused") patchUi(result.proposalId, { refusal: result.refusal });
      }
      setMoves((current) => ({ ...current, undoAllBatchId: response.batchId }));
      const refused = response.results.filter((result) => result.outcome === "refused").length;
      if (refused) setBatchNotice(refused === 1 ? "One item could not be moved; see its line." : `${refused} items could not be moved; see their lines.`);
      setBatchExplainer(firstUseExplainer("accept_all"));
      if (response.results.some((result) => result.outcome === "applied")) refresh();
    } catch (error) {
      setBatchNotice(requestRefusal(error).message);
    } finally {
      setBatchPending(false);
    }
  };

  const undoAll = async () => {
    const batchId = moves.undoAllBatchId;
    if (!batchId || batchPending) return;
    setBatchPending(true);
    setBatchNotice(null);
    try {
      const response = await client.answer({ kind: "undo_all", batchId, idempotencyKey: newKey() });
      for (const result of response.results) {
        if (result.line) replaceLine(result.proposalId, result.line);
        if (result.outcome === "applied" && result.line) timeline?.dismissMoveConfirmation(result.line.occurrenceId);
      }
      setMoves((current) => ({ ...current, undoAllBatchId: null }));
      if (response.results.some((result) => result.outcome === "applied")) refresh();
    } catch (error) {
      setBatchNotice(requestRefusal(error).message);
    } finally {
      setBatchPending(false);
    }
  };

  if (!shown.length && !conflicts.length && moves.calendar !== "stale") return null;

  return (
    <div className="mt-3 border-t border-line pt-2" data-brief-moves>
      {moves.calendar === "stale" ? <AlertNotice kind="data_stale" label="Calendar not current" size="compact" className="mb-2">
        Your calendar couldn’t be read just now, so times that depend on it aren’t offered.
      </AlertNotice> : null}
      {(moves.acceptAll && open.length >= 2) || moves.undoAllBatchId ? <p className="text-sm leading-6" data-brief-accept-all>
        {moves.acceptAll && open.length >= 2
          ? <button type="button" className={`font-bold text-foreground ${LINK}`} disabled={batchPending} onClick={() => void acceptAll()}>Accept all</button>
          : null}
        {moves.acceptAll && open.length >= 2 && moves.undoAllBatchId ? " · " : null}
        {moves.undoAllBatchId
          ? <button type="button" className={LINK} disabled={batchPending} onClick={() => void undoAll()} data-brief-undo-all>Undo all</button>
          : null}
      </p> : null}
      {batchNotice ? <AlertNotice kind="write_refused" size="compact" className="mb-2">{batchNotice}</AlertNotice> : null}
      {batchExplainer ? <p className="text-xs leading-5 text-muted-readable" data-brief-explainer>{batchExplainer}</p> : null}
      <ul className="grid gap-3">
        {shown.map((line) => <MoveLine
          key={line.proposalId}
          line={line}
          ui={ui[line.proposalId] ?? {}}
          onYes={() => void yes(line)}
          onNo={() => void answer(line, { kind: "no", proposalId: line.proposalId, idempotencyKey: newKey() })}
          onAlreadyDone={() => void answer(line, { kind: "already_done", proposalId: line.proposalId, expectedRevision: line.expectedRevision, idempotencyKey: newKey() })}
          onNeverMove={() => void answer(line, { kind: "never_move", proposalId: line.proposalId, idempotencyKey: newKey() })}
          onUndo={() => void undo(line)}
          onOtherTime={(startAt) => void otherTime(line, startAt)}
          onReplan={() => void replan(line)}
          onLength={(minutes) => void changeLength(line, minutes)}
          onPanel={(panel) => patchUi(line.proposalId, { panel, refusal: null })}
        />)}
        {conflicts.map((conflict) => <ConflictLine
          key={conflict.conflictId}
          conflict={conflict}
          timezone={moves.timezone}
          onKeep={timeline ? async () => { if (await timeline.keep(conflict.conflictId)) setKeptConflicts((current) => new Set(current).add(conflict.conflictId)); } : null}
          onMove={timeline ? () => timeline.openMenu(conflict.occurrenceId) : null}
        />)}
      </ul>
    </div>
  );
}

type MoveLineProps = Readonly<{
  line: BriefMoveLine;
  ui: LineUi;
  onYes: () => void;
  onNo: () => void;
  onAlreadyDone: () => void;
  onNeverMove: () => void;
  onUndo: () => void;
  onOtherTime: (startAt: string) => void;
  onReplan: () => void;
  onLength: (minutes: number) => void;
  onPanel: (panel: LineUi["panel"]) => void;
}>;

function MoveLine({ line, ui, onYes, onNo, onAlreadyDone, onNeverMove, onUndo, onOtherTime, onReplan, onLength, onPanel }: MoveLineProps) {
  const from = moveTimeLabel(line.from.startAt, line.timezone);
  const to = moveTimeLabel(line.to.startAt, line.timezone);
  const closed = line.status === "declined" || line.status === "undone" || line.status === "already_done";
  const moved = (line.status === "accepted" || line.status === "other_time") && !!line.moveId;
  const pending = !!ui.pending;
  return (
    <li className={`break-words text-sm leading-6 transition-opacity [overflow-wrap:anywhere] motion-reduce:transition-none ${closed ? "opacity-60" : ""}`}
      data-brief-move-line={line.proposalId} data-brief-move-status={line.status}>
      <p>
        <span className="font-bold">{line.title}</span>{" "}
        {moved
          ? <span className="whitespace-nowrap">moved to {ui.movedTo ? moveTimeLabel(ui.movedTo, line.timezone) : to}</span>
          : <span className="whitespace-nowrap tabular-nums">{from} → {to}</span>}
      </p>
      {!closed && !moved ? <p className="text-foreground">{line.reason}</p> : null}
      {!closed && !moved && (line.length.assumed || line.travel === "not_checked") ? <p className="text-xs leading-5 text-muted-readable">
        {line.length.assumed ? <>{line.length.minutes} min is a guess ·{" "}
          <button type="button" className={LINK} disabled={pending} onClick={() => onPanel(ui.panel === "length" ? null : "length")} aria-expanded={ui.panel === "length"}>set length</button></> : null}
        {line.length.assumed && line.travel === "not_checked" ? " · " : null}
        {line.travel === "not_checked" ? "travel not checked" : null}
      </p> : null}
      {line.status === "proposed" ? <p data-brief-move-actions>
        <ActionLink label="Yes" strong disabled={pending} onClick={onYes} />
        <Dot /><ActionLink label="No" disabled={pending} onClick={onNo} />
        <Dot /><ActionLink label="Other time" disabled={pending} onClick={() => onPanel(ui.panel === "other_time" ? null : "other_time")} expanded={ui.panel === "other_time"} />
        {line.late ? <><Dot /><ActionLink label="Already did it" disabled={pending} onClick={onAlreadyDone} /></> : null}
        {line.offerNeverMove ? <><Dot /><ActionLink label="Don’t suggest moving this" disabled={pending} onClick={onNeverMove} /></> : null}
      </p> : <p className="text-xs leading-5 text-muted-readable" data-brief-move-actions>
        {moved ? <>For today only. <ActionLink label="Undo" disabled={pending} onClick={onUndo} /></> : null}
        {line.status === "declined" || line.status === "undone" ? "Not moving this today." : null}
        {line.status === "already_done" ? "Marked Completed." : null}
        {line.offerNeverMove && line.status === "declined" ? <> <ActionLink label="Don’t suggest moving this" disabled={pending} onClick={onNeverMove} /></> : null}
      </p>}
      {ui.panel === "other_time" && line.status === "proposed" ? <OtherTimePanel line={line} pending={pending} onPick={onOtherTime} onReplan={onReplan} /> : null}
      {ui.panel === "length" ? <LengthPanel minutes={line.length.minutes} pending={pending} onSave={onLength} onCancel={() => onPanel(null)} /> : null}
      {ui.refusal ? <AlertNotice kind="write_refused" size="compact" className="mt-1"
        action={ui.refusal.alternatives.length ? <span>Free:{" "}{ui.refusal.alternatives.map((instant, index) => <span key={instant} className="whitespace-nowrap">
          {index ? " · " : ""}<button type="button" className={LINK} disabled={pending} onClick={() => onOtherTime(instant)}>{moveTimeLabel(instant, line.timezone)}</button>
        </span>)}</span> : undefined}>
        {ui.refusal.message}
      </AlertNotice> : null}
      {ui.explainer ? <p className="text-xs leading-5 text-muted-readable" data-brief-explainer>{ui.explainer}</p> : null}
    </li>
  );
}

/** Other time: the planner's other free starts, a time picker, then Re-plan. */
function OtherTimePanel({ line, pending, onPick, onReplan }: Readonly<{
  line: BriefMoveLine;
  pending: boolean;
  onPick: (startAt: string) => void;
  onReplan: () => void;
}>) {
  const [time, setTime] = useState(() => wallTime(line.to.startAt, line.timezone));
  const picked = pickedInstant(line, time);
  return (
    <div className="mt-1 grid gap-1 border-l border-line pl-3 text-sm leading-6" data-brief-other-time>
      {line.otherTimes.length ? <p>
        <span>Free today: </span>
        {line.otherTimes.map((instant, index) => <span key={instant} className="whitespace-nowrap">
          {index ? " · " : ""}<button type="button" className={LINK} disabled={pending} onClick={() => onPick(instant)}>{moveTimeLabel(instant, line.timezone)}</button>
        </span>)}
      </p> : <p>No other free time found today.</p>}
      <p className="flex flex-wrap items-center gap-x-2">
        <label htmlFor={`brief-time-${line.proposalId}`}>Or pick a time</label>
        <input id={`brief-time-${line.proposalId}`} type="time" step={300} value={time} onChange={(event) => setTime(event.target.value)}
          className="min-h-11 border-0 border-b border-line bg-transparent px-0 py-1 text-sm tabular-nums focus:border-foreground focus:outline-none sm:min-h-9" />
        <button type="button" className={LINK} disabled={pending || !picked} onClick={() => picked && onPick(picked)}>Move</button>
      </p>
      <p><button type="button" className={LINK} disabled={pending} onClick={onReplan}>Re-plan</button></p>
      <p className="text-xs leading-5 text-muted-readable">Re-plan finds a new time with what’s on your calendar now.</p>
    </div>
  );
}

function LengthPanel({ minutes, pending, onSave, onCancel }: Readonly<{ minutes: number; pending: boolean; onSave: (minutes: number) => void; onCancel: () => void }>) {
  const [value, setValue] = useState(String(minutes));
  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 5 && parsed <= 720;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 border-l border-line pl-3 text-sm leading-6" data-brief-length>
      <label htmlFor="brief-length">Usually takes</label>
      <input id="brief-length" type="number" inputMode="numeric" min={5} max={720} step={5} value={value} onChange={(event) => setValue(event.target.value)}
        className="min-h-11 w-16 border-0 border-b border-line bg-transparent px-0 py-1 text-sm tabular-nums focus:border-foreground focus:outline-none sm:min-h-9" />
      <span>min</span>
      <button type="button" className={LINK} disabled={pending || !valid} onClick={() => onSave(parsed)}>Save</button>
      <span aria-hidden="true">·</span>
      <button type="button" className={LINK} disabled={pending} onClick={onCancel}>Cancel</button>
    </p>
  );
}

/** An open schedule-edit collision (Phase 2), as a line in the brief. */
function ConflictLine({ conflict, timezone, onKeep, onMove }: Readonly<{
  conflict: BriefMoveConflictLine;
  timezone: string;
  onKeep: (() => Promise<void>) | null;
  onMove: (() => void) | null;
}>) {
  const [pending, setPending] = useState(false);
  const at = moveTimeLabel(conflict.at.startAt, timezone);
  return (
    <li className="break-words text-sm leading-6 [overflow-wrap:anywhere]" data-brief-conflict={conflict.conflictId}>
      <p><span className="font-bold">{conflict.title}</span> <span className="whitespace-nowrap tabular-nums">at {at}</span></p>
      <p>{conflict.conflictingTitle
        ? `Your schedule change put it on top of ${conflict.conflictingTitle}.`
        : "Your schedule change put another item at the same time."}</p>
      {onKeep || onMove ? <p>
        {onKeep ? <ActionLink label="Keep it here" disabled={pending} onClick={() => { setPending(true); void onKeep().finally(() => setPending(false)); }} /> : null}
        {onKeep && onMove ? <Dot /> : null}
        {onMove ? <ActionLink label="Move it" disabled={pending} onClick={onMove} /> : null}
      </p> : null}
    </li>
  );
}

function ActionLink({ label, onClick, disabled, strong = false, expanded }: Readonly<{ label: string; onClick: () => void; disabled?: boolean; strong?: boolean; expanded?: boolean }>) {
  return <button type="button" className={`${strong ? "font-bold text-foreground " : ""}${LINK}`} disabled={disabled} onClick={onClick}
    {...(expanded === undefined ? {} : { "aria-expanded": expanded })}>{label}</button>;
}

function Dot() {
  return <span aria-hidden="true"> · </span>;
}

/** The time picker's wall time on the line's day, as a UTC instant; null when it does not exist that day. */
function pickedInstant(line: BriefMoveLine, time: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  try {
    return Temporal.PlainDate.from(line.localDate)
      .toZonedDateTime({ timeZone: line.timezone, plainTime: Temporal.PlainTime.from(time) })
      .toInstant().toString();
  } catch {
    return null;
  }
}

/** After a Yes, the item's revision changed; Undo and Other time send the newest one the screen knows. */
function revisionAfter(line: BriefMoveLine, ui: Readonly<Record<string, LineUi>>): string {
  return ui[line.proposalId]?.revision ?? line.expectedRevision;
}

function firstUseExplainer(kind: BriefMoveAnswerKind): string | null {
  const text = BRIEF_ANSWER_EXPLAINERS[kind];
  if (!text) return null;
  try {
    const seen = new Set<string>(JSON.parse(window.localStorage.getItem(EXPLAINED_KEY) ?? "[]") as string[]);
    if (seen.has(kind)) return null;
    seen.add(kind);
    window.localStorage.setItem(EXPLAINED_KEY, JSON.stringify([...seen]));
    return text;
  } catch {
    return null;
  }
}

function requestRefusal(error: unknown): BriefMoveRefusal {
  const code = error instanceof DailyBriefRequestError ? error.code : "advisor_unavailable";
  const message = code === "offline" ? "You appear to be offline. Nothing changed."
    : code === "proposal_closed" ? "This suggestion was already answered on another device."
      : code === "proposal_not_found" ? "This suggestion is no longer available. Refresh the brief for current ones."
        : code === "revision_changed" ? "This item changed since the brief was written. Nothing changed; refresh the brief to see it."
        : code === "rate_limited" ? "Too many changes at once. Try again in a moment."
          : code === "timeout" ? "That took too long. Nothing changed; try again."
            : "Cadence couldn’t apply that. Nothing changed.";
  return { reason: code, message, alternatives: [], revision: null };
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
