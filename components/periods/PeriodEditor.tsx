"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";

import { PERIOD_LIMITS, resolvePeriodCreate, resolvePeriodEndState } from "@cadence/core/resolvers/period.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import type {
  PeriodActionState,
  PeriodActions,
  PeriodFormAction,
  PeriodNoteFormAction,
  PeriodNoticeId,
  PeriodView,
} from "@/lib/types/period";
import { COMPACT_UNDERLINED_FIELD_CONTROL_CLASS } from "@/lib/ui/field-classes";
import { useRefresh } from "@cadence/ui/runtime";

import { AlertNotice } from "@/components/feedback/AlertNotice";
import { Notice } from "@/components/feedback/Notice";
import { NoteEditor, NoteField } from "@/components/notes/NoteEditor";

/**
 * The one editor for a Period (Ticket 369, D35): Label, First day, Last day and Note.
 * Without `period` it adds one, and Save sends all four fields. With `period` it
 * edits that one: Save sends the label and the days, and the note saves on its own
 * through the shared note editor, as every note does. An existing Period also offers
 * End today, when the Period resolver allows it, and Remove, which takes a second tap.
 * Every rule lives in the Period resolver and services; this form only shows the
 * sentence they return. A Period is annotation only: nothing here marks an
 * Occurrence or changes a schedule, a reminder or adherence.
 */

const IDLE: PeriodActionState = { status: "idle", message: "" };
const LABEL = "text-sm text-muted-readable";
/** The standard field at a width that fits one date, 44px tall on phones for the native picker. */
const DATE_FIELD = `${COMPACT_UNDERLINED_FIELD_CONTROL_CLASS} min-h-11 w-[9.5rem] max-w-full tabular-nums sm:min-h-8`;
const ACTION = "product-action min-h-11";
const QUIET_ACTION = "product-action product-action-secondary min-h-11 text-sm sm:min-h-8";

type Draft = Readonly<{ label: string; startOn: string; endOn: string; note: string }>;

function draftOf(period: PeriodView | undefined, today: string): Draft {
  return period
    ? { label: period.label, startOn: period.start_on, endOn: period.end_on ?? "", note: period.note ?? "" }
    : { label: "", startOn: today, endOn: "", note: "" };
}

/**
 * The draft after the Period changed underneath it, for example when its note
 * auto-saved: a field the person has not touched takes the new value, and one they
 * are editing keeps their text.
 */
function rebaseDraft(draft: Draft, from: PeriodView, to: PeriodView, today: string): Draft {
  const before = draftOf(from, today);
  const after = draftOf(to, today);
  return {
    label: draft.label === before.label ? after.label : draft.label,
    startOn: draft.startOn === before.startOn ? after.startOn : draft.startOn,
    endOn: draft.endOn === before.endOn ? after.endOn : draft.endOn,
    note: after.note,
  };
}

export type PeriodEditorProps = Readonly<{
  /** The Period to edit. Absent: the form adds a new one. */
  period?: PeriodView;
  /** Today's local date in the account's timezone. */
  today: string;
  labelSuggestions: readonly string[];
  /** Lines that repeat across Period notes, offered as chips above the note. */
  noteShortcuts?: readonly NoteShortcut[];
  actions: PeriodActions;
  /** Called after a save, End today or Remove succeeded, with the outcome notice to show. */
  onDone: (noticeId: PeriodNoticeId) => void;
  onCancel: () => void;
}>;

export function PeriodEditor({
  period, today, labelSuggestions, noteShortcuts, actions, onDone, onCancel,
}: PeriodEditorProps) {
  const refresh = useRefresh();
  const fieldId = useId();
  const formId = `${fieldId}-form`;
  const [draft, setDraft] = useState<Draft>(() => draftOf(period, today));
  const [seen, setSeen] = useState(period);
  const [resetOnReload, setResetOnReload] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // An existing Period closes through its note editor, so a note still unsaved, or
  // typed while a save was in flight, is saved first.
  const [closeSignal, setCloseSignal] = useState(0);
  const requestClose = period ? () => setCloseSignal((signal) => signal + 1) : onCancel;
  const removeRef = useRef<HTMLButtonElement>(null);
  const returnToRemove = useRef(false);
  const endRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // The note saves on its own and moves the revision. A write that follows waits for
  // a note save in flight and names the revision that save returned.
  const noteSave = useRef<Promise<unknown> | null>(null);
  const noteRevision = useRef(0);

  if (period && seen && period.revision !== seen.revision) {
    setSeen(period);
    if (resetOnReload) {
      // After a conflict the page reloads the Period: show its latest values, keep the message.
      setDraft(draftOf(period, today));
      setConfirmingRemove(false);
      setResetOnReload(false);
    } else {
      setDraft(rebaseDraft(draft, seen, period, today));
    }
  }

  const saveNote = useCallback<PeriodNoteFormAction>(async (previous, form) => {
    const sent = actions.saveNote(previous, form);
    noteSave.current = sent;
    try {
      const result = await sent;
      if (result.status === "success" && result.revision !== undefined) {
        noteRevision.current = Math.max(noteRevision.current, result.revision);
      }
      return result;
    } finally {
      if (noteSave.current === sent) noteSave.current = null;
    }
  }, [actions]);

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
    if (noteSave.current) await noteSave.current.catch(() => undefined);
    if (form.has("expected_revision") && noteRevision.current > Number(form.get("expected_revision"))) {
      form.set("expected_revision", String(noteRevision.current));
    }
    const action = kind === "end" ? actions.end : kind === "remove" ? actions.remove : actions.save;
    const result = await action(previous, form);
    if (result.status === "success") {
      refresh();
      onDone(result.noticeId ?? "period.saved");
    } else if (result.noticeId === "period.conflict") {
      setResetOnReload(true);
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
  const setNote = (note: string) => setDraft((current) => ({ ...current, note }));

  return (
    <div
      className="grid max-w-2xl gap-3 border-l border-line pl-3 text-sm"
      data-period-editor={period?.id ?? "new"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          // The note field handles its own Escape: it saves, then closes through onDone.
          if (!event.defaultPrevented) requestClose();
        }
      }}
    >
      <form id={formId} action={formAction} noValidate className="grid gap-3"
        aria-label={period ? `Edit period ${period.label}` : "Add period"}>
        <input type="hidden" name="period_action" value="save" />
        {target}
        <div className="grid gap-1">
          <label htmlFor={`${fieldId}-label`} className={LABEL}>Label</label>
          <input id={`${fieldId}-label`} name="label" type="text" autoComplete="off" autoFocus
            maxLength={PERIOD_LIMITS.labelCharacters}
            list={labelSuggestions.length > 0 ? `${fieldId}-labels` : undefined}
            value={draft.label} onChange={set("label")}
            className={`${COMPACT_UNDERLINED_FIELD_CONTROL_CLASS} w-full max-w-sm`} />
          {labelSuggestions.length > 0 ? (
            <datalist id={`${fieldId}-labels`}>
              {labelSuggestions.map((label) => <option key={label} value={label} />)}
            </datalist>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="grid gap-1">
            <label htmlFor={`${fieldId}-start`} className={LABEL}>First day</label>
            <input id={`${fieldId}-start`} name="start_on" type="date" min="0001-01-01" max="9999-12-31"
              value={draft.startOn} onChange={set("startOn")} className={DATE_FIELD} />
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${fieldId}-end`} className={LABEL}>Last day</label>
            <div className="flex flex-wrap items-center gap-x-3">
              <input ref={endRef} id={`${fieldId}-end`} name="end_on" type="date" min={draft.startOn || "0001-01-01"} max="9999-12-31"
                value={draft.endOn} onChange={set("endOn")} aria-describedby={`${fieldId}-end-help`} className={DATE_FIELD} />
              {draft.endOn ? (
                <button type="button" className={QUIET_ACTION} aria-label="Clear last day"
                  onClick={() => { setDraft((current) => ({ ...current, endOn: "" })); endRef.current?.focus(); }}>
                  Clear
                </button>
              ) : null}
              <p id={`${fieldId}-end-help`} className={draft.endOn ? "sr-only" : "text-sm text-muted-readable"}>
                {draft.endOn ? "Clear the last day if it is still going" : "Still going. Set a last day when it ends."}
              </p>
            </div>
          </div>
        </div>
      </form>

      <div className="grid gap-1" data-period-note>
        <span aria-hidden="true" className={LABEL}>Note</span>
        {period ? (
          <NoteEditor
            key={period.id}
            targetFields={{ period_id: period.id }}
            note={period.note ?? ""}
            action={saveNote}
            shortcuts={noteShortcuts}
            label="Note"
            hideLabel
            placeholder="Add a note about this period"
            shortcutsLabel="Period note shortcuts"
            showDone={false}
            doneSignal={closeSignal}
            onDone={onCancel}
            compact
          />
        ) : (
          <NoteField
            textareaRef={noteRef}
            form={formId}
            value={draft.note}
            shortcuts={noteShortcuts}
            label="Note"
            hideLabel
            placeholder="Add a note about this period"
            shortcutsLabel="Period note shortcuts"
            compact
            onValueChange={setNote}
            onShortcutInsert={setNote}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4">
        <button type="submit" form={formId} disabled={pending} className={`${ACTION} product-action-primary font-bold`}>Save</button>
        <button type="button" className={`${ACTION} product-action-secondary`} onClick={requestClose}>
          {period ? "Close" : "Cancel"}
        </button>
      </div>

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
