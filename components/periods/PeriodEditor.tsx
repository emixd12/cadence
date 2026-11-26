"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";

import { resolvePeriodCreate, resolvePeriodEndState } from "@cadence/core/resolvers/period.resolver";
import type {
  PeriodActionState,
  PeriodActions,
  PeriodFormAction,
  PeriodNoticeId,
  PeriodView,
} from "@/lib/types/period";
import { useRefresh } from "@cadence/ui/runtime";

import { AlertNotice } from "@/components/feedback/AlertNotice";
import { Notice } from "@/components/feedback/Notice";

/**
 * The one form for a Period (Ticket 369, D35): Label, First day, Last day and Note.
 * Without `period` it adds one. With `period` it edits that one and also offers End
 * today, when the Period resolver allows it, and Remove, which takes a second tap.
 * Every rule lives in the Period resolver and services; this form only shows the
 * sentence they return. A Period is annotation only: nothing here marks an
 * Occurrence or changes a schedule, a reminder or adherence.
 */

const IDLE: PeriodActionState = { status: "idle", message: "" };
const FIELD = "min-h-11 min-w-0 w-full border border-line bg-background px-2 text-base font-normal text-foreground";
const ACTION = "product-action min-h-11";

type Draft = Readonly<{ label: string; startOn: string; endOn: string; note: string }>;

function draftOf(period: PeriodView | undefined, today: string): Draft {
  return period
    ? { label: period.label, startOn: period.start_on, endOn: period.end_on ?? "", note: period.note ?? "" }
    : { label: "", startOn: today, endOn: "", note: "" };
}

export type PeriodEditorProps = Readonly<{
  /** The Period to edit. Absent: the form adds a new one. */
  period?: PeriodView;
  /** Today's local date in the account's timezone. */
  today: string;
  labelSuggestions: readonly string[];
  actions: PeriodActions;
  /** Called after a save, End today or Remove succeeded, with the outcome notice to show. */
  onDone: (noticeId: PeriodNoticeId) => void;
  onCancel: () => void;
}>;

export function PeriodEditor({ period, today, labelSuggestions, actions, onDone, onCancel }: PeriodEditorProps) {
  const refresh = useRefresh();
  const fieldId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(period, today));
  const [seenRevision, setSeenRevision] = useState(period?.revision);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const returnToRemove = useRef(false);

  // After a conflict the page reloads the Period: show its latest values, keep the message.
  if (period && period.revision !== seenRevision) {
    setSeenRevision(period.revision);
    setDraft(draftOf(period, today));
    setConfirmingRemove(false);
  }

  const run = useCallback<PeriodFormAction>(async (previous, form) => {
    const kind = form.get("period_action");
    form.delete("period_action");
    if (kind === "save") {
      // The same rules the service applies, read first so a slip needs no round trip.
      try {
        resolvePeriodCreate({
          label: form.get("label"), startOn: form.get("start_on"), endOn: form.get("end_on"), note: form.get("note"),
        });
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Unable to save this period." };
      }
    }
    const action = kind === "end" ? actions.end : kind === "remove" ? actions.remove : actions.save;
    const result = await action(previous, form);
    if (result.status === "success") {
      refresh();
      onDone(result.noticeId ?? "period.saved");
    } else if (result.noticeId === "period.conflict") {
      refresh();
    }
    return result;
  }, [actions, onDone, refresh]);
  const [state, formAction, pending] = useActionState(run, IDLE);

  useEffect(() => {
    if (!confirmingRemove && returnToRemove.current) {
      returnToRemove.current = false;
      removeRef.current?.focus();
    }
  }, [confirmingRemove]);

  const canEndToday = period !== undefined && resolvePeriodEndState({ period, today }) === "allowed";
  const target = period ? (
    <>
      <input type="hidden" name="period_id" value={period.id} />
      <input type="hidden" name="expected_revision" value={period.revision} />
    </>
  ) : null;
  const set = (field: keyof Draft) => (event: { currentTarget: { value: string } }) => {
    const value = event.currentTarget.value;
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <div
      className="grid max-w-2xl gap-3 border-l border-line pl-3 text-sm"
      data-period-editor={period?.id ?? "new"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <form action={formAction} className="grid gap-3" aria-label={period ? `Edit period ${period.label}` : "Add period"}>
        <input type="hidden" name="period_action" value="save" />
        {target}
        <div className="grid gap-1">
          <label htmlFor={`${fieldId}-label`}>Label</label>
          <input id={`${fieldId}-label`} name="label" type="text" autoComplete="off" autoFocus
            list={labelSuggestions.length > 0 ? `${fieldId}-labels` : undefined}
            value={draft.label} onChange={set("label")} className={FIELD} />
          {labelSuggestions.length > 0 ? (
            <datalist id={`${fieldId}-labels`}>
              {labelSuggestions.map((label) => <option key={label} value={label} />)}
            </datalist>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-1">
            <label htmlFor={`${fieldId}-start`}>First day</label>
            <input id={`${fieldId}-start`} name="start_on" type="date" min="0001-01-01" max="9999-12-31"
              value={draft.startOn} onChange={set("startOn")} className={FIELD} />
          </div>
          <div className="grid content-start gap-1">
            <label htmlFor={`${fieldId}-end`}>Last day</label>
            <input id={`${fieldId}-end`} name="end_on" type="date" min="0001-01-01" max="9999-12-31"
              value={draft.endOn} onChange={set("endOn")} aria-describedby={`${fieldId}-end-help`} className={FIELD} />
            <p id={`${fieldId}-end-help`} className="text-xs text-muted-readable">Leave empty if it is still going</p>
          </div>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${fieldId}-note`}>Note</label>
          <textarea id={`${fieldId}-note`} name="note" rows={2} value={draft.note} onChange={set("note")}
            className="min-h-16 resize-y border border-line bg-background px-2 py-2 text-base font-normal leading-7 text-foreground" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4">
          <button type="submit" disabled={pending} className={`${ACTION} product-action-primary font-bold`}>Save</button>
          <button type="button" className={`${ACTION} product-action-secondary`} onClick={onCancel}>Cancel</button>
        </div>
      </form>

      {period ? (
        <div className="flex flex-wrap items-center gap-x-4 border-t border-line pt-1">
          {canEndToday ? (
            <form action={formAction} className="contents">
              <input type="hidden" name="period_action" value="end" />
              {target}
              <button type="submit" disabled={pending} className={`${ACTION} product-action-primary`}>End today</button>
            </form>
          ) : null}
          {confirmingRemove ? (
            <form action={formAction} className="contents">
              <input type="hidden" name="period_action" value="remove" />
              {target}
              <button type="submit" disabled={pending} autoFocus className={`${ACTION} product-action-danger`}>
                Remove this period
              </button>
              <button type="button" className={`${ACTION} product-action-secondary`}
                onClick={() => { returnToRemove.current = true; setConfirmingRemove(false); }}>
                Keep
              </button>
            </form>
          ) : (
            <button ref={removeRef} type="button" className={`${ACTION} product-action-secondary`}
              onClick={() => setConfirmingRemove(true)}>
              Remove
            </button>
          )}
        </div>
      ) : null}

      {state.status === "error" && !pending ? (
        state.noticeId === "period.conflict"
          ? <Notice id="period.conflict" size="small" />
          : <AlertNotice kind="write_refused" label={false} variant="inline" size="small" data={{ "data-period-error": true }}>
              {state.message}
            </AlertNotice>
      ) : null}
    </div>
  );
}
