"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { CalendarRange } from "lucide-react";

import { periodRangeLabel } from "@cadence/core/resolvers/period.resolver";
import type { PeriodActions, PeriodNoticeId, PeriodView } from "@/lib/types/period";

import { Notice } from "@/components/feedback/Notice";
import { PeriodEditor } from "@/components/periods/PeriodEditor";

/**
 * Periods on the screens (Ticket 369, D35). A Period is a labeled range of local
 * dates the person declares for the whole account. It is annotation only.
 *
 * - `PeriodDayControls`: a Timeline day header's chips, and on today "Add period"
 *   beside the day note control.
 * - `PeriodList`: every Period, newest first, on Behaviors.
 *
 * Both take the three writes as `actions`. Without them they draw nothing of their
 * own, so a runtime that passes none, such as Cadence for Mac before Ticket 374, is
 * unchanged. Nothing here imports a server module.
 */

type Shared = Readonly<{
  /** Today's local date in the account's timezone. */
  today: string;
  /** Past labels, newest first, offered in the Label field. */
  labelSuggestions?: readonly string[];
  /** Save, End today and Remove. Absent: no Period control is drawn. */
  actions?: PeriodActions;
}>;

const NO_SUGGESTIONS: readonly string[] = [];
const CHIP = "min-w-0 truncate border px-1.5 leading-6";
const CHIP_CLOSED = "border-line bg-surface text-foreground";
/** The chip whose editor is open takes the selected-chip fill (DESIGN.md, "Chips"). */
const CHIP_OPEN = "border-primary bg-primary text-primary-foreground";

export type PeriodDayControlsProps = Shared & Readonly<{
  localDate: string;
  /** The day's heading text, for control names ("Monday, November 9"). */
  dayLabel: string;
  /** The Periods that cover this day, in display order. */
  periods?: readonly PeriodView[];
  /** The day note control. It keeps its place; "Add period" sits beside it. */
  children?: ReactNode;
}>;

/** A Timeline day header's Period controls. Without `actions` it returns its children as they are. */
export function PeriodDayControls({
  localDate,
  dayLabel,
  periods = [],
  today,
  labelSuggestions = NO_SUGGESTIONS,
  actions,
  children = null,
}: PeriodDayControlsProps) {
  if (!actions) return <>{children}</>;
  return (
    <>
      <PeriodChips localDate={localDate} dayLabel={dayLabel} periods={periods} today={today}
        labelSuggestions={labelSuggestions} actions={actions} />
      <div className="flex flex-wrap items-start gap-x-5">
        {children ? <div className="min-w-0 has-[details[open]]:w-full">{children}</div> : null}
        {localDate === today ? <PeriodAdd today={today} labelSuggestions={labelSuggestions} actions={actions} /> : null}
      </div>
    </>
  );
}

/** One chip per Period that covers the day. A chip opens that Period's editor in place. */
function PeriodChips({ localDate, dayLabel, periods, today, labelSuggestions, actions }: Readonly<{
  localDate: string;
  dayLabel: string;
  periods: readonly PeriodView[];
  today: string;
  labelSuggestions: readonly string[];
  actions: PeriodActions;
}>) {
  const panelId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<PeriodNoticeId | null>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const open = periods.find((period) => period.id === openId) ?? null;

  if (periods.length === 0 && !notice) return null;

  const close = (id: string) => {
    setOpenId(null);
    chips.current.get(id)?.focus();
  };

  return (
    // One minmax(0, 1fr) column: a long label truncates instead of widening a grid ancestor.
    <div className="mt-1 grid grid-cols-[minmax(0,1fr)] text-sm" data-period-chips={localDate}>
      {periods.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-2" aria-label={`Periods on ${dayLabel}`}>
          {periods.map((period) => (
            <li key={period.id} className="flex min-w-0">
              <button
                type="button"
                ref={(node) => { if (node) chips.current.set(period.id, node); else chips.current.delete(period.id); }}
                className="inline-flex min-h-11 min-w-0 max-w-full cursor-pointer items-center sm:min-h-8"
                aria-expanded={open?.id === period.id}
                aria-controls={open?.id === period.id ? panelId : undefined}
                aria-label={`Edit period ${period.label}, ${periodRangeLabel(period, { today })}`}
                onClick={() => { setNotice(null); setOpenId(open?.id === period.id ? null : period.id); }}
              >
                <span className={`${CHIP} ${open?.id === period.id ? CHIP_OPEN : CHIP_CLOSED}`}>{period.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div id={panelId} className="mt-1 mb-2">
          <PeriodEditor key={open.id} period={open} today={today} labelSuggestions={labelSuggestions} actions={actions}
            onDone={(noticeId) => { setNotice(noticeId); close(open.id); }}
            onCancel={() => close(open.id)} />
        </div>
      ) : null}
      {notice && !open ? <Notice id={notice} className="text-xs" /> : null}
    </div>
  );
}

/** "Add period", a disclosure styled like "Add day note". Shown on today only. */
function PeriodAdd({ today, labelSuggestions, actions }: Readonly<{
  today: string;
  labelSuggestions: readonly string[];
  actions: PeriodActions;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState<PeriodNoticeId | null>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const close = () => {
    setIsOpen(false);
    summaryRef.current?.focus();
  };

  return (
    <div className={["min-w-0 text-sm", isOpen ? "w-full" : ""].join(" ")} data-period-add={today}>
      <details
        open={isOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setIsOpen(nextOpen);
          if (nextOpen) setNotice(null);
        }}
        className="mt-2"
      >
        <summary
          ref={summaryRef}
          className="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 py-1 font-bold text-muted-readable hover:text-foreground focus-visible:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden"
        >
          <CalendarRange aria-hidden="true" size={16} strokeWidth={2.25} className="shrink-0" />
          <span>Add period</span>
        </summary>
        {isOpen ? (
          <div className="mt-2">
            <PeriodEditor today={today} labelSuggestions={labelSuggestions} actions={actions}
              onDone={(noticeId) => { setNotice(noticeId); close(); }}
              onCancel={close} />
          </div>
        ) : null}
      </details>
      {notice && !isOpen ? <Notice id={notice} className="text-xs" /> : null}
    </div>
  );
}

export type PeriodListProps = Shared & Readonly<{
  /** Every Period of the account, newest first. */
  periods?: readonly PeriodView[];
}>;

/** Every Period, newest first, each with the same editor. Hidden when there is none. */
export function PeriodList({ periods = [], today, labelSuggestions = NO_SUGGESTIONS, actions }: PeriodListProps) {
  const titleId = useId();
  const panelId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<PeriodNoticeId | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  if (!actions || (periods.length === 0 && !notice)) return null;

  const close = (id: string) => {
    setOpenId(null);
    triggers.current.get(id)?.focus();
  };

  return (
    <section className="grid gap-4 border-t border-line pt-4" aria-labelledby={titleId} data-period-list>
      <h2 id={titleId} className="text-xl leading-tight">Periods</h2>
      {notice ? <Notice id={notice} className="text-sm" /> : null}
      {periods.length > 0 ? (
        <ul className="border-t border-line">
          {periods.map((period) => {
            const isOpen = openId === period.id;
            return (
              <li key={period.id} className="border-b border-line py-1" data-period={period.id}>
                <div className="flex items-start justify-between gap-x-4">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] py-2 text-sm">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className="min-w-0 break-words text-base">{period.label}</span>
                      <span className="text-muted-readable tabular-nums">{periodRangeLabel(period, { today })}</span>
                    </p>
                    {period.note && !isOpen ? <p className="truncate text-muted-readable">{period.note}</p> : null}
                  </div>
                  <button
                    type="button"
                    ref={(node) => { if (node) triggers.current.set(period.id, node); else triggers.current.delete(period.id); }}
                    className="product-action product-action-primary min-h-11 shrink-0"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    aria-label={`Edit period ${period.label}`}
                    onClick={() => { setNotice(null); setOpenId(isOpen ? null : period.id); }}
                  >
                    Edit
                  </button>
                </div>
                {isOpen ? (
                  <div id={panelId} className="mb-2">
                    <PeriodEditor key={period.id} period={period} today={today} labelSuggestions={labelSuggestions}
                      actions={actions}
                      onDone={(noticeId) => { setNotice(noticeId); close(period.id); }}
                      onCancel={() => close(period.id)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
