"use client";

import { Temporal } from "@js-temporal/polyfill";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { canSelfMoveOccurrence } from "@cadence/core/resolvers/move.resolver";
import { calendarEventPlace, type CalendarEventPlace, type PlanningPlaceCatalog } from "@cadence/core/resolvers/alongside.resolver";
import { formatClockTimeLabel } from "@cadence/core/services/schedule";
import { useRefresh } from "@cadence/ui/runtime";
import { noticeText } from "@cadence/core/notices";
import { BottomDrawerNotice } from "@/components/feedback/BottomDrawerNotice";
import { Notice } from "@/components/feedback/Notice";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";

/**
 * Advisor plan, Phase 2C: the person's own "Move for today" on the web Timeline.
 * The page passes the server actions in; the Mac renders the same rows without this
 * provider, so it shows moves but never offers one. Rules: one day only, no
 * confirmation step (Undo instead), optional one-tap reasons after the move.
 */

/**
 * `eventPlace` (Ticket 384): the event's coarse place, computed on this screen from its
 * location text and the view's `planningPlaces`. Sent only while the view carries
 * `planningPlaces` (`CADENCE_ALONGSIDE` on); never the location text itself.
 */
export type MoveCalendarBusy = ReadonlyArray<Readonly<{ start: string; end: string; ref?: string; eventPlace?: CalendarEventPlace }>>;

type MoveState =
  | Readonly<{ status: "moved" | "undone"; occurrenceId: string; moveId: string; effectiveStartAt: string | null; revision: string }>
  | Readonly<{ status: "refused"; occurrenceId: string; reason: string; message: string; alternatives: readonly string[]; revision: string | null; currentStartAt: string | null }>
  | Readonly<{ status: "error"; message: string }>;

export type OccurrenceMoveActions = Readonly<{
  move: (input: Readonly<{ occurrenceId: string; expectedRevision: string; startTime: string; calendarBusy?: MoveCalendarBusy; idempotencyKey?: string | null }>) => Promise<MoveState>;
  revert: (input: Readonly<{ occurrenceId: string; expectedRevision: string; idempotencyKey?: string | null }>) => Promise<MoveState>;
  reason: (input: Readonly<{ moveId: string; reason: string }>) => Promise<Readonly<{ status: "saved"; reason: string } | { status: "error"; message: string }>>;
  suggest: (input: Readonly<{ occurrenceId: string; calendarBusy?: MoveCalendarBusy }>) => Promise<readonly string[]>;
  keep: (input: Readonly<{ conflictId: string }>) => Promise<Readonly<{ status: "kept" } | { status: "error"; message: string }>>;
}>;

export const MOVE_REASON_OPTIONS = [
  { value: "running_late", label: "Running late" },
  { value: "conflict", label: "Conflict" },
  { value: "low_energy", label: "Low energy" },
  { value: "other", label: "Other" },
] as const;

export const FIRST_MOVE_LINE = noticeText("move.first-move");

/** A refusal or another device's change, shown on the row in the shared alert style. */
export type MoveRowNotice = Readonly<{
  message: string;
  /** Free start times the refusal offers, as UTC instants. */
  alternatives: readonly string[];
  /** The revision to send with an alternative, from the refusal. */
  revision: string | null;
  /** "Move it again" reopens the menu instead of offering times. */
  moveAgain: boolean;
}>;

type MoveToast = Readonly<{
  key: number;
  /** Advisor Phase 3: a brief move's Undo goes through the brief's own answer (it counts as a No). */
  onUndo?: () => Promise<void>;
  occurrenceId: string;
  title: string;
  kind: "moved" | "undone";
  /** Time labels: where the item was and where it is now. */
  from: string | null;
  to: string | null;
  revision: string | null;
  canUndo: boolean;
}>;

type RowMove = Readonly<{ moveId: string; reason: string | null; first: boolean }>;

/** A move the Daily Brief applied (Yes, Other time), shown in the same drawer as a self-move. */
export type BriefMoveConfirmation = Readonly<{
  occurrenceId: string;
  title: string;
  moveId: string;
  /** Time labels: where the item was and where it is now. */
  from: string | null;
  to: string;
  /** From the answer: this was the person's first move ever (brief and self-moves count). */
  showFirstMoveLine: boolean;
  onUndo: () => Promise<void>;
}>;

export type OccurrenceMovesController = Readonly<{
  timezone: string;
  todayLocalDate: string;
  pendingId: string | null;
  canMove: (occurrence: TimelineOccurrenceView) => boolean;
  rowMove: (occurrenceId: string) => RowMove | null;
  notice: (occurrenceId: string) => MoveRowNotice | null;
  clearNotice: (occurrenceId: string) => void;
  suggest: (occurrenceId: string, calendarBusy: MoveCalendarBusy) => Promise<readonly string[]>;
  move: (occurrence: TimelineOccurrenceView, startTime: string, calendarBusy: MoveCalendarBusy, revision?: string | null) => Promise<void>;
  undo: (occurrence: Pick<TimelineOccurrenceView, "id" | "title" | "revision"> & Readonly<{ scheduledFor?: string }>, revision?: string | null) => Promise<void>;
  recordReason: (occurrenceId: string, reason: string) => Promise<void>;
  keep: (conflictId: string) => Promise<boolean>;
  menuRequest: Readonly<{ occurrenceId: string; key: number }> | null;
  openMenu: (occurrenceId: string) => void;
  /** Advisor Phase 3: open the move drawer for a move the brief applied. */
  confirmBriefMove: (move: BriefMoveConfirmation) => void;
  /** Advisor Phase 3: close the drawer when it shows this item (its brief move was undone elsewhere). */
  dismissMoveConfirmation: (occurrenceId: string) => void;
}>;

const OccurrenceMovesContext = createContext<OccurrenceMovesController | null>(null);

/** Today's Calendar events, from the Day progress Timeline, for the free-slot check. */
export const MoveCalendarEventsContext = createContext<readonly NormalizedExternalEvent[]>([]);

/** Ticket 384: the Timeline view's `planningPlaces`, or null while it carries none. */
export const MovePlanningPlacesContext = createContext<PlanningPlaceCatalog | null>(null);

export function useOccurrenceMoves(): OccurrenceMovesController | null {
  return useContext(OccurrenceMovesContext);
}

export function useMoveCalendarBusy(): MoveCalendarBusy {
  const events = useContext(MoveCalendarEventsContext);
  const places = useContext(MovePlanningPlacesContext);
  return useMemo(() => calendarBusyFromEvents(events, places), [events, places]);
}

/**
 * Timed events that hold the person's time. Free, cancelled and declined ones do not.
 * With `places` (Ticket 384), an event whose location keys to Home or a saved place
 * carries that coarse place; any other event carries none (unknown).
 */
export function calendarBusyFromEvents(events: readonly NormalizedExternalEvent[], places: PlanningPlaceCatalog | null = null): MoveCalendarBusy {
  return events.flatMap((event) => {
    if (event.kind !== "timed" || event.endUnspecified || event.state === "cancelled" || event.availability === "free"
      || event.currentUserResponse === "declined") return [];
    const eventPlace = calendarEventPlace(event.location, places);
    return [{ start: event.startAt, end: event.endAt, ref: event.id, ...(eventPlace ? { eventPlace } : {}) }];
  });
}

/** Ticket 384: each Calendar event's coarse place by event id, for the overlap cues. Empty without `places`. */
export function calendarEventPlacesById(events: readonly NormalizedExternalEvent[], places: PlanningPlaceCatalog | null | undefined)
  : ReadonlyMap<string, CalendarEventPlace> {
  const byId = new Map<string, CalendarEventPlace>();
  if (!places) return byId;
  for (const event of events) {
    const place = calendarEventPlace(event.location, places);
    if (place) byId.set(event.id, place);
  }
  return byId;
}

/** "10:30 AM" for an instant in the person's timezone. */
export function moveTimeLabel(instant: string, timezone: string): string {
  return formatClockTimeLabel(wallTime(instant, timezone));
}

/** "10:30" (24-hour) for an instant in the person's timezone, as the move action takes it. */
export function wallTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: "minute" });
}


export function OccurrenceMovesProvider({
  actions,
  timezone,
  todayLocalDate,
  hasMovedBefore,
  children,
}: Readonly<{
  actions: OccurrenceMoveActions;
  timezone: string;
  todayLocalDate: string;
  hasMovedBefore: boolean;
  children: ReactNode;
}>) {
  const refresh = useRefresh();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowMoves, setRowMoves] = useState<Readonly<Record<string, RowMove>>>({});
  const [notices, setNotices] = useState<Readonly<Record<string, MoveRowNotice>>>({});
  const [toast, setToast] = useState<MoveToast | null>(null);
  const [menuRequest, setMenuRequest] = useState<Readonly<{ occurrenceId: string; key: number }> | null>(null);
  const movedBefore = useRef(hasMovedBefore);
  const toastKey = useRef(0);

  const setNotice = useCallback((occurrenceId: string, notice: MoveRowNotice | null) => {
    setNotices((current) => {
      const next = { ...current };
      if (notice) next[occurrenceId] = notice;
      else delete next[occurrenceId];
      return next;
    });
  }, []);

  const showToast = useCallback((value: Omit<MoveToast, "key">) => {
    toastKey.current += 1;
    setToast({ ...value, key: toastKey.current });
  }, []);

  const refusal = useCallback((occurrence: Pick<TimelineOccurrenceView, "id" | "title" | "scheduledFor">, state: MoveState) => {
    if (state.status === "error") {
      setNotice(occurrence.id, { message: state.message, alternatives: [], revision: null, moveAgain: false });
      return;
    }
    if (state.status !== "refused") return;
    // Another device got there first: say where the item is now, and offer to move it again.
    const movedElsewhere = state.reason === "revision_changed" && state.currentStartAt
      && !sameInstant(state.currentStartAt, occurrence.scheduledFor);
    setNotice(occurrence.id, movedElsewhere
      ? { message: noticeText("move.moved-on-another-device", { title: occurrence.title, time: moveTimeLabel(state.currentStartAt!, timezone) }), alternatives: [], revision: state.revision, moveAgain: true }
      : { message: state.message, alternatives: state.alternatives, revision: state.revision, moveAgain: state.reason === "revision_changed" });
    refresh();
  }, [refresh, setNotice, timezone]);

  const controller = useMemo<OccurrenceMovesController>(() => ({
    timezone,
    todayLocalDate,
    pendingId,
    canMove: (occurrence) => canSelfMoveOccurrence(occurrence, todayLocalDate),
    rowMove: (occurrenceId) => rowMoves[occurrenceId] ?? null,
    notice: (occurrenceId) => notices[occurrenceId] ?? null,
    clearNotice: (occurrenceId) => setNotice(occurrenceId, null),
    suggest: (occurrenceId, calendarBusy) => actions.suggest({ occurrenceId, calendarBusy }),
    async move(occurrence, startTime, calendarBusy, revision) {
      const expectedRevision = revision ?? occurrence.revision;
      if (!expectedRevision || pendingId) return;
      setPendingId(occurrence.id);
      setNotice(occurrence.id, null);
      try {
        const state = await actions.move({
          occurrenceId: occurrence.id, expectedRevision, startTime, calendarBusy, idempotencyKey: newKey(),
        });
        if (state.status !== "moved") {
          refusal(occurrence, state);
          return;
        }
        const first = !movedBefore.current;
        movedBefore.current = true;
        setRowMoves((current) => ({ ...current, [occurrence.id]: { moveId: state.moveId, reason: null, first } }));
        const to = state.effectiveStartAt ? moveTimeLabel(state.effectiveStartAt, timezone) : formatClockTimeLabel(startTime);
        showToast({ occurrenceId: occurrence.id, title: occurrence.title, kind: "moved", from: occurrence.scheduledTimeLabel, to, revision: state.revision, canUndo: true });
      } finally {
        setPendingId(null);
      }
    },
    async undo(occurrence, revision) {
      const expectedRevision = revision ?? occurrence.revision;
      if (!expectedRevision || pendingId) return;
      setPendingId(occurrence.id);
      setNotice(occurrence.id, null);
      try {
        const state = await actions.revert({ occurrenceId: occurrence.id, expectedRevision, idempotencyKey: newKey() });
        if (state.status !== "undone") {
          setToast((current) => current?.occurrenceId === occurrence.id ? null : current);
          refusal({ id: occurrence.id, title: occurrence.title, scheduledFor: occurrence.scheduledFor ?? "" }, state);
          return;
        }
        setRowMoves((current) => {
          const next = { ...current };
          delete next[occurrence.id];
          return next;
        });
        const back = state.effectiveStartAt ? moveTimeLabel(state.effectiveStartAt, timezone) : null;
        showToast({ occurrenceId: occurrence.id, title: occurrence.title, kind: "undone", from: null, to: back, revision: null, canUndo: false });
      } finally {
        setPendingId(null);
      }
    },
    async recordReason(occurrenceId, reason) {
      const move = rowMoves[occurrenceId];
      if (!move || move.reason) return;
      setRowMoves((current) => ({ ...current, [occurrenceId]: { ...move, reason } }));
      const result = await actions.reason({ moveId: move.moveId, reason });
      setRowMoves((current) => current[occurrenceId]?.moveId === move.moveId
        ? { ...current, [occurrenceId]: { ...move, reason: result.status === "saved" ? result.reason : null } }
        : current);
    },
    async keep(conflictId) {
      const result = await actions.keep({ conflictId });
      return result.status === "kept";
    },
    menuRequest,
    openMenu: (occurrenceId) => setMenuRequest((current) => ({ occurrenceId, key: (current?.key ?? 0) + 1 })),
    confirmBriefMove(move) {
      const first = move.showFirstMoveLine && !movedBefore.current;
      movedBefore.current = true;
      setRowMoves((current) => ({ ...current, [move.occurrenceId]: { moveId: move.moveId, reason: null, first } }));
      showToast({ occurrenceId: move.occurrenceId, title: move.title, kind: "moved", from: move.from, to: move.to, revision: null, canUndo: true, onUndo: move.onUndo });
    },
    dismissMoveConfirmation(occurrenceId) {
      setToast((current) => current?.occurrenceId === occurrenceId ? null : current);
      setRowMoves((current) => {
        if (!current[occurrenceId]) return current;
        const next = { ...current };
        delete next[occurrenceId];
        return next;
      });
    },
  }), [actions, menuRequest, notices, pendingId, refusal, rowMoves, setNotice, showToast, timezone, todayLocalDate]);

  return (
    <OccurrenceMovesContext.Provider value={controller}>
      {children}
      <MoveConfirmation
        key={toast?.key}
        toast={toast}
        controller={controller}
        onClose={() => setToast(null)}
        onUndo={(value) => {
          setToast(null);
          if (value.onUndo) { void value.onUndo(); return; }
          void controller.undo({ id: value.occurrenceId, title: value.title, revision: undefined }, value.revision);
        }}
      />
    </OccurrenceMovesContext.Provider>
  );
}

const LINK = "-my-2 inline-block py-2 underline underline-offset-2 hover:text-foreground disabled:opacity-60";

function toastNotice(toast: MoveToast): Readonly<{ id: "move.moved" | "move.undone" | "move.undone-usual-time"; params: Readonly<Record<string, string>> }> {
  if (toast.kind === "undone") return toast.to ? { id: "move.undone", params: { title: toast.title, time: toast.to } } : { id: "move.undone-usual-time", params: { title: toast.title } };
  return { id: "move.moved", params: { title: toast.title, time: toast.to ?? "" } };
}

/**
 * The optional one-tap reasons after a move. A tap reads back as "Reason noted".
 * Shown in the move confirmation drawer.
 */
export function MoveReasonLine({ occurrenceId, className }: Readonly<{ occurrenceId: string; className?: string }>) {
  const moves = useOccurrenceMoves();
  const rowMove = moves?.rowMove(occurrenceId) ?? null;
  if (!moves || !rowMove) return null;
  const reasonLabel = rowMove.reason ? MOVE_REASON_OPTIONS.find((option) => option.value === rowMove.reason)?.label : null;
  return (
    <p className={className} data-move-reasons>
      {reasonLabel ? <Notice id="move.reason-noted" params={{ reason: reasonLabel.toLowerCase() }} as="span" announce={false} /> : <>
        Why?{" "}
        {MOVE_REASON_OPTIONS.map((option, index) => (
          <span key={option.value} className="whitespace-nowrap">
            {index ? " · " : ""}
            <button type="button" className={LINK} data-move-reason={option.value}
              onClick={() => void moves.recordReason(occurrenceId, option.value)}>{option.label}</button>
          </span>
        ))}
      </>}
    </p>
  );
}

/**
 * The move's confirmation, in the shared bottom drawer (owner decision, 2026-11-18):
 * what moved, Undo, the one-time first-move line and the optional reasons. It stays
 * until closed or replaced by the next notice, so the reasons are not missed.
 */
function MoveConfirmation({ toast, controller, onClose, onUndo }: Readonly<{
  toast: MoveToast | null;
  controller: OccurrenceMovesController;
  onClose: () => void;
  onUndo: (toast: MoveToast) => void;
}>) {
  if (!toast) return null;
  const rowMove = toast.kind === "moved" ? controller.rowMove(toast.occurrenceId) : null;
  return (
    <BottomDrawerNotice onClose={onClose} dataAttribute="data-move-toast">
      <Notice {...toastNotice(toast)} announce={false} className="text-base leading-6" action={toast.canUndo
        ? <button type="button" className={`font-bold text-foreground ${LINK}`} disabled={controller.pendingId === toast.occurrenceId}
          onClick={() => onUndo(toast)} data-move-confirmation-undo>Undo</button>
        : undefined} />
      {rowMove ? <div className="grid gap-1 text-sm leading-5 text-muted-readable">
        {rowMove.first ? <Notice id="move.first-move" data={{ "data-first-move": true }} /> : null}
        <MoveReasonLine occurrenceId={toast.occurrenceId} />
      </div> : null}
    </BottomDrawerNotice>
  );
}

function sameInstant(left: string, right: string): boolean {
  try {
    return Temporal.Instant.from(left).equals(Temporal.Instant.from(right));
  } catch {
    return false;
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
