"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { X } from "lucide-react";
import type { NoticeId } from "@cadence/core/notices";
import { resuggestOpportunityPool } from "@cadence/core/services/opportunity-pool";
import { TIME_RANGE_PRESET_LIST, type TimeRangePreset } from "@cadence/core/types/schedule";

import { Notice } from "@/components/feedback/Notice";
import { useMoveCalendarBusy } from "@/components/timeline/OccurrenceMoves";
import type {
  OpportunityActionState,
  OpportunityFormAction,
  TimelineOpportunityPoolItem,
  TimelineView,
} from "@/lib/types/timeline";

type OpportunityBasketProps = Readonly<{
  timeline: TimelineView;
  /** The current instant; default starts are recomputed from it when calendar events are known. */
  now: string;
  addAction?: OpportunityFormAction;
}>;

const EMPTY_POOL: readonly TimelineOpportunityPoolItem[] = [];
const IDLE: OpportunityActionState = { status: "idle" };
const ACTION_CLASS = "inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4 hover:text-foreground disabled:opacity-60 sm:min-h-8";

/**
 * Behaviors of Opportunity: the quiet "Opportunity (n)" control under today's date. It
 * opens a non-modal ledger of today's pool: an inline drawer on wide screens and a
 * bottom sheet on phones. Hidden when the pool is empty or no add action is injected.
 */
export function OpportunityBasket({ timeline, now, addAction }: OpportunityBasketProps) {
  const pool = timeline.opportunityPool ?? EMPTY_POOL;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const calendarBusy = useMoveCalendarBusy();
  const items = useMemo(() => resuggestOpportunityPool({
    pool, timeline, now: Temporal.Instant.from(now), calendarBusy,
  }), [pool, timeline, now, calendarBusy]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!addAction || pool.length === 0) return null;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="mt-1 text-sm" data-opportunity-basket>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`${ACTION_CLASS} text-muted-readable`}
      >
        Opportunity ({pool.length})
      </button>
      {open ? (
        <section
          id={panelId}
          aria-label="Opportunities for today"
          className="fixed inset-x-0 bottom-0 z-[45] max-h-[min(24rem,55dvh)] overflow-y-auto border-t border-line bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-foreground sm:static sm:z-auto sm:mt-2 sm:max-h-none sm:max-w-2xl sm:overflow-visible sm:border sm:pb-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold leading-6">Opportunities</h3>
            <button type="button" aria-label="Close opportunities" title="Close" onClick={close}
              className="product-icon-action -mr-2 min-h-11 min-w-11 sm:min-h-8 sm:min-w-8">
              <X aria-hidden="true" size={16} strokeWidth={2.5} />
            </button>
          </div>
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {items.map((item) => <OpportunityItem key={item.behaviorId} item={item} action={addAction} />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OpportunityItem({ item, action }: Readonly<{ item: TimelineOpportunityPoolItem; action: OpportunityFormAction }>) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  // The selector closes on the first "added" result after it opened; a refusal keeps it.
  const [openedAt, setOpenedAt] = useState<OpportunityActionState | null>(null);
  const choosing = openedAt !== null && !(state !== openedAt && state.status === "added");
  const setChoosing = (value: boolean) => setOpenedAt(value ? state : null);
  const meta = itemMeta(item);

  function submit(fields: Readonly<Record<string, string>>) {
    const formData = new FormData();
    formData.set("behavior_id", item.behaviorId);
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    // A fresh id per submit: a replay of the same tap is safe, a second tap is a second item.
    formData.set("client_occurrence_id", newOccurrenceId());
    startTransition(() => dispatch(formData));
  }

  return (
    <li className="grid gap-1 py-3" data-opportunity-item={item.behaviorId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="break-words font-bold leading-6">{item.title}</p>
          {meta ? <p className="text-xs leading-5 text-muted-readable">{meta}</p> : null}
          {item.onToday ? <p className="text-xs leading-5 text-muted-readable" data-on-today>On today</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button type="button" className={ACTION_CLASS} aria-expanded={choosing} disabled={pending}
            onClick={() => setChoosing(!choosing)}>Add to today</button>
          <button type="button" className={ACTION_CLASS} disabled={pending}
            onClick={() => submit({ placement: "done_now" })}>Done now</button>
        </div>
      </div>
      {choosing ? <OpportunityPlacementForm item={item} pending={pending} onCancel={() => setChoosing(false)} onSubmit={submit} /> : null}
      {state.status !== "idle" ? <Notice id={state.noticeId as NoticeId} params={"noticeParams" in state ? state.noticeParams : undefined}
        size="small" className="text-sm leading-5" data={{ "data-opportunity-result": state.status }} /> : null}
    </li>
  );
}

type Mode = "exact" | "window";
type WindowChoice = TimeRangePreset | "custom";

function OpportunityPlacementForm({ item, pending, onCancel, onSubmit }: Readonly<{
  item: TimelineOpportunityPoolItem;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fields: Readonly<Record<string, string>>) => void;
}>) {
  const [mode, setMode] = useState<Mode>("exact");
  const [startTime, setStartTime] = useState(item.suggestedStart.localTime);
  const [windowChoice, setWindowChoice] = useState<WindowChoice>(presetAt(item.suggestedStart.localTime));
  const [rangeStart, setRangeStart] = useState(item.suggestedStart.localTime);
  const [rangeEnd, setRangeEnd] = useState(addMinutes(item.suggestedStart.localTime, item.lengthMinutes));
  const name = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "exact") onSubmit({ placement: "exact", start_time: startTime });
    else if (windowChoice === "custom") onSubmit({ placement: "range", start_time: rangeStart, end_time: rangeEnd });
    else onSubmit({ placement: "preset", preset: windowChoice });
  }

  const fieldClass = "min-h-11 border border-line bg-background px-2 text-sm sm:min-h-9";
  return (
    <form onSubmit={handleSubmit} className="grid gap-3 border-t border-line pt-3" aria-label={`Add ${item.title} to today`}>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
        <legend className="sr-only">Timing</legend>
        {(["exact", "window"] as const).map((value) => (
          <label key={value} className="inline-flex min-h-11 items-center gap-2 sm:min-h-8">
            <input type="radio" name={name} value={value} checked={mode === value} onChange={() => setMode(value)} />
            {value === "exact" ? "Exact time" : "Time window"}
          </label>
        ))}
      </fieldset>
      {mode === "exact" ? (
        <label className="grid max-w-40 gap-1">
          <span className="text-xs text-muted-readable">Start</span>
          <input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldClass} />
        </label>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-muted-readable">Window</span>
            <select value={windowChoice} onChange={(event) => setWindowChoice(event.target.value as WindowChoice)} className={fieldClass}>
              {TIME_RANGE_PRESET_LIST.map((preset) => <option key={preset.preset} value={preset.preset}>{preset.label} ({preset.rangeLabel})</option>)}
              <option value="custom">Custom</option>
            </select>
          </label>
          {windowChoice === "custom" ? <>
            <label className="grid gap-1">
              <span className="text-xs text-muted-readable">From</span>
              <input type="time" required value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-readable">To</span>
              <input type="time" required value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className={fieldClass} />
            </label>
          </> : null}
        </div>
      )}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className="product-action product-action-primary min-h-11 px-4 text-sm font-bold sm:min-h-9">
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" className={ACTION_CLASS} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function itemMeta(item: TimelineOpportunityPoolItem): string {
  const where = item.whereKind === "home" ? "Home"
    : item.whereKind === "anywhere" ? "Anywhere"
      : item.whereKind === "place" ? item.locationText?.trim() || "A place" : null;
  return [`${item.lengthMinutes} min`, where].filter(Boolean).join(" · ");
}

function presetAt(localTime: string): TimeRangePreset {
  const hour = Number(localTime.slice(0, 2));
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function addMinutes(localTime: string, minutes: number): string {
  const time = Temporal.PlainTime.from(localTime).add({ minutes: Math.max(5, minutes) });
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function newOccurrenceId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Behaviors of Opportunity: Remove on a clean added row, today or in Needs decision. The
 * hosted function holds the rules; the row offers it only when `canRemove` is true.
 */
export function OpportunityRemoveControl({ occurrenceId, title, action }: Readonly<{
  occurrenceId: string;
  title: string;
  action: OpportunityFormAction;
}>) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  return (
    <div className="grid gap-1" data-opportunity-remove>
      <form action={dispatch}>
        <input type="hidden" name="occurrence_id" value={occurrenceId} />
        <input type="hidden" name="title" value={title} />
        <button type="submit" disabled={pending} className={`${ACTION_CLASS} text-foreground`}>
          {pending ? "Removing…" : "Remove"}
        </button>
      </form>
      {state.status !== "idle" ? <Notice id={state.noticeId as NoticeId} params={"noticeParams" in state ? state.noticeParams : undefined}
        size="small" className="text-sm leading-5" data={{ "data-opportunity-result": state.status }} /> : null}
    </div>
  );
}
