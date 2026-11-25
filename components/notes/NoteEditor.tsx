"use client";

import { useRefresh } from "@cadence/ui/runtime";
import {
  createContext,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { resolveNoteUpdate } from "@cadence/core/resolvers/status.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import type {
  OccurrenceActionState,
  OccurrenceFormAction,
} from "@/lib/types/timeline";
import { DesktopDraftGuard } from "@/lib/desktop-draft";

export const NOTE_AUTO_SAVE_DELAY_MS = 750;
export const NOTE_CLOSED_SAVED_MS = 2_500;

export type NoteShortcutDismissHandler = (poolId: string, key: string) => Promise<void> | void;

const NoteShortcutDismissContext = createContext<NoteShortcutDismissHandler | null>(null);

export function NoteShortcutDismissProvider({
  onDismiss,
  children,
}: Readonly<{
  onDismiss: NoteShortcutDismissHandler;
  children: ReactNode;
}>) {
  return (
    <NoteShortcutDismissContext.Provider value={onDismiss}>
      {children}
    </NoteShortcutDismissContext.Provider>
  );
}

export type NoteEditorProps = Readonly<{
  /** Hidden fields that identify the note target, such as occurrence_id or local_date. */
  targetFields: Readonly<Record<string, string>>;
  note: string;
  action: OccurrenceFormAction;
  shortcuts?: readonly NoteShortcut[];
  poolId?: string;
  onDismissShortcut?: NoteShortcutDismissHandler;
  compact?: boolean;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  shortcutsLabel?: string;
  autoFocus?: boolean;
  focusSignal?: number;
  autoSave?: boolean;
  onSaved?: (savedNote: string) => void;
  onDone?: (result: Readonly<{ saved: boolean }>) => void;
}>;

const EMPTY_ACTION_STATE: OccurrenceActionState = {
  status: "idle",
  message: "",
};

export function reconcileSavedNoteDraft({
  submittedDraft,
  submittedRevision,
  currentDraft,
  currentRevision,
}: Readonly<{
  submittedDraft: string;
  submittedRevision: number;
  currentDraft: string;
  currentRevision: number;
}>): string {
  return submittedRevision === currentRevision ? submittedDraft : currentDraft;
}

export function insertNoteShortcutDraft(draft: string, shortcut: string): string {
  return draft ? `${draft}\n${shortcut}` : shortcut;
}

/**
 * The shared note editor for Occurrence notes and day notes. It owns the
 * compare-and-set expected note, shortcut chips, auto-save, and unsaved-draft handling.
 */
export function NoteEditor({
  targetFields,
  note,
  action,
  shortcuts = [],
  poolId,
  onDismissShortcut,
  compact = false,
  label = "Note",
  hideLabel = false,
  placeholder = "Add a note",
  shortcutsLabel = "Note shortcuts",
  autoFocus = false,
  focusSignal = 0,
  autoSave = true,
  onSaved,
  onDone,
}: NoteEditorProps) {
  const [state, formAction, isPending] = useActionState(action, EMPTY_ACTION_STATE);
  const refresh = useRefresh();
  const contextDismiss = useContext(NoteShortcutDismissContext);
  const dismissHandler = onDismissShortcut ?? contextDismiss;
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRevisionRef = useRef(0);
  const draftValueRef = useRef(note);
  const [draftValue, setDraftValue] = useState(note);
  const expectedNoteRef = useRef(note);
  const [expectedNoteValue, setExpectedNoteValue] = useState(note);
  const submittedDraftRef = useRef<{
    value: string;
    revision: number;
  } | null>(null);
  const usedShortcutRef = useRef(false);
  const [usedShortcutValue, setUsedShortcutValue] = useState(false);

  const isPendingRef = useRef(isPending);
  const targetFieldsRef = useRef(targetFields);
  const onSavedRef = useRef(onSaved);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    isPendingRef.current = isPending;
    targetFieldsRef.current = targetFields;
    onSavedRef.current = onSaved;
    onDoneRef.current = onDone;
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedSaveRef = useRef(false);
  const closeAfterSaveRef = useRef(false);
  const savedSinceOpenRef = useRef(false);

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const submitCurrentDraft = useCallback(() => {
    cancelDebounce();
    if (isPendingRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    const formData = new FormData();
    for (const [name, value] of Object.entries(targetFieldsRef.current)) {
      formData.set(name, value);
    }
    formData.set("note", draftValueRef.current);
    formData.set("expected_note", expectedNoteRef.current);
    formData.set("used_shortcut", String(usedShortcutRef.current));
    queuedSaveRef.current = false;
    submittedDraftRef.current = {
      value: draftValueRef.current,
      revision: draftRevisionRef.current,
    };
    startTransition(() => {
      formAction(formData);
    });
  }, [cancelDebounce, formAction]);

  useEffect(() => cancelDebounce, [cancelDebounce]);

  useEffect(() => {
    if (focusSignal <= 0) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
  }, [focusSignal]);

  useEffect(() => {
    const submittedDraft = submittedDraftRef.current;
    if (state.status !== "idle" && submittedDraft) {
      submittedDraftRef.current = null;
      if (state.status === "success") {
        const canonicalSaved = canonicalNoteValue(submittedDraft.value);
        expectedNoteRef.current = canonicalSaved;
        setExpectedNoteValue(canonicalSaved);
        savedSinceOpenRef.current = true;
      }
      if (textareaRef.current) {
        textareaRef.current.value = reconcileSavedNoteDraft({
          submittedDraft: submittedDraft.value,
          submittedRevision: submittedDraft.revision,
          currentDraft: draftValueRef.current,
          currentRevision: draftRevisionRef.current,
        });
        draftValueRef.current = textareaRef.current.value;
        setDraftValue(textareaRef.current.value);
      }
      if (state.status === "success" && submittedDraft.revision === draftRevisionRef.current) {
        usedShortcutRef.current = false;
        setUsedShortcutValue(false);
      }

      if (state.status === "success") {
        onSavedRef.current?.(expectedNoteRef.current);
        refresh();
        const stillDirty = canonicalNoteValue(draftValueRef.current) !== expectedNoteRef.current;
        if (stillDirty && (queuedSaveRef.current || closeAfterSaveRef.current)) {
          submitCurrentDraft();
        } else if (!stillDirty && closeAfterSaveRef.current) {
          closeAfterSaveRef.current = false;
          savedSinceOpenRef.current = false;
          onDoneRef.current?.({ saved: true });
        }
      } else if (state.status === "error") {
        closeAfterSaveRef.current = false;
        queuedSaveRef.current = false;
      }
    }
  }, [refresh, state, submitCurrentDraft]);

  useEffect(() => {
    if (note === expectedNoteRef.current) return;
    if (canonicalNoteValue(draftValueRef.current) !== expectedNoteRef.current) return;

    expectedNoteRef.current = note;
    setExpectedNoteValue(note);
    draftValueRef.current = note;
    setDraftValue(note);
    usedShortcutRef.current = false;
    setUsedShortcutValue(false);
    if (textareaRef.current) textareaRef.current.value = note;
  }, [note]);

  const isDirty = canonicalNoteValue(draftValue) !== expectedNoteValue;

  const handleDone = useCallback(() => {
    cancelDebounce();
    const currentlyDirty = canonicalNoteValue(draftValueRef.current) !== expectedNoteRef.current;
    if (isPendingRef.current) {
      closeAfterSaveRef.current = true;
      if (currentlyDirty) {
        queuedSaveRef.current = true;
      }
      return;
    }
    if (currentlyDirty) {
      closeAfterSaveRef.current = true;
      submitCurrentDraft();
      return;
    }
    const hadSaved = savedSinceOpenRef.current || state.status === "success";
    savedSinceOpenRef.current = false;
    onDoneRef.current?.({ saved: hadSaved });
  }, [cancelDebounce, state.status, submitCurrentDraft]);

  const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (!autoSave) return;
    if (event.relatedTarget instanceof Node && formRef.current?.contains(event.relatedTarget)) {
      return;
    }
    cancelDebounce();
    if (canonicalNoteValue(draftValueRef.current) !== expectedNoteRef.current) {
      submitCurrentDraft();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleDone();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleDone();
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={() => {
        cancelDebounce();
        queuedSaveRef.current = false;
        submittedDraftRef.current = {
          value: draftValueRef.current,
          revision: draftRevisionRef.current,
        };
      }}
      className={["grid", compact ? "gap-1" : "gap-3"].join(" ")}
    >
      <DesktopDraftGuard
        dirty={isDirty}
        pending={isPending}
        onDiscard={() => {
          cancelDebounce();
          queuedSaveRef.current = false;
          closeAfterSaveRef.current = false;
          const saved = expectedNoteRef.current;
          draftRevisionRef.current += 1;
          draftValueRef.current = saved;
          setDraftValue(saved);
          usedShortcutRef.current = false;
          setUsedShortcutValue(false);
          if (textareaRef.current) textareaRef.current.value = saved;
        }}
      />
      {Object.entries(targetFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="expected_note" value={expectedNoteValue} readOnly />
      <input type="hidden" name="used_shortcut" value={String(usedShortcutValue)} readOnly />
      {(() => {
        const visibleShortcuts = shortcuts
          .filter((shortcut) => (shortcut.status === "accepted" || shortcut.status === "proposed") && Boolean(shortcut.text) && !dismissedKeys.has(shortcut.key))
          .slice(0, 5);
        if (visibleShortcuts.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-2" aria-label={shortcutsLabel}>
            {visibleShortcuts.map((shortcut) => {
              const text = shortcut.text!;
              const canDismiss = Boolean(dismissHandler && poolId);
              return (
                <span key={shortcut.key} className="inline-flex max-w-full items-stretch">
                  <button
                    type="button"
                    className="product-action product-action-secondary min-h-11 max-w-full break-words py-2 text-left text-sm"
                    onClick={() => {
                      const textarea = textareaRef.current;
                      if (!textarea) return;
                      textarea.value = insertNoteShortcutDraft(textarea.value, text);
                      draftValueRef.current = textarea.value;
                      setDraftValue(textarea.value);
                      draftRevisionRef.current += 1;
                      usedShortcutRef.current = true;
                      setUsedShortcutValue(true);
                      textarea.focus();
                      if (autoSave) {
                        submitCurrentDraft();
                      }
                    }}
                  >
                    {text}
                  </button>
                  {canDismiss ? (
                    <button
                      type="button"
                      aria-label={`Dismiss shortcut "${text}"`}
                      title="Dismiss shortcut"
                      className="product-action product-action-secondary min-h-11 border-l-0 px-2 py-2 text-sm text-muted-readable hover:text-foreground"
                      onClick={() => {
                        setDismissedKeys((prev) => new Set([...prev, shortcut.key]));
                        void Promise.resolve(dismissHandler!(poolId!, shortcut.key)).then(() => {
                          refresh();
                        });
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        );
      })()}
      <label
        className={[
          "grid font-bold text-foreground",
          compact ? "gap-1" : "gap-2",
        ].join(" ")}
      >
        <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
        <textarea
          ref={textareaRef}
          name="note"
          defaultValue={note}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            draftValueRef.current = nextValue;
            setDraftValue(nextValue);
            draftRevisionRef.current += 1;
            cancelDebounce();
            if (autoSave && canonicalNoteValue(nextValue) !== expectedNoteRef.current) {
              debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                if (canonicalNoteValue(draftValueRef.current) !== expectedNoteRef.current) {
                  submitCurrentDraft();
                }
              }, NOTE_AUTO_SAVE_DELAY_MS);
            }
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          rows={3}
          autoFocus={autoFocus}
          data-surface="default"
          className="min-h-24 resize-y border border-line bg-background px-3 py-2 text-base font-normal leading-7 text-foreground placeholder:text-muted-readable"
          placeholder={placeholder}
        />
      </label>

      <div
        className={[
          "flex flex-col gap-2 sm:flex-row sm:items-baseline",
          compact ? "items-start" : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {state.status === "error" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={submitCurrentDraft}
            className={[
              "timeline-status-action product-action product-action-primary min-h-11 py-1 text-sm font-bold sm:min-h-8",
              compact ? "!items-start !pb-0 !pt-0" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {isPending ? "Saving..." : "Try again"}
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={handleDone}
            className={[
              "timeline-status-action product-action product-action-primary min-h-11 py-1 text-sm font-bold sm:min-h-8",
              compact ? "!items-start !pb-0 !pt-0" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {isPending ? "Saving..." : "Done"}
          </button>
        )}
        {state.status === "error" && onDone ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              closeAfterSaveRef.current = false;
              savedSinceOpenRef.current = false;
              onDoneRef.current?.({ saved: false });
            }}
            className={[
              "timeline-status-action product-action product-action-secondary min-h-11 py-1 text-sm font-bold sm:min-h-8",
              compact ? "!items-start !pb-0 !pt-0" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            Close
          </button>
        ) : null}
        <NoteStatusMessage state={state} isPending={isPending} isDirty={isDirty} />
      </div>
    </form>
  );
}

function canonicalNoteValue(note: string): string {
  return resolveNoteUpdate({ note }).note ?? "";
}

function NoteStatusMessage({
  state,
  isPending,
  isDirty,
}: Readonly<{
  state: OccurrenceActionState;
  isPending: boolean;
  isDirty: boolean;
}>) {
  const isError = state.status === "error" && Boolean(state.message);
  const message = isError
    ? state.message
    : isPending
      ? "Saving..."
      : state.status === "success" && !isDirty
        ? "Saved"
        : "";

  if (!message) {
    return null;
  }

  return (
    <p
      className={[
        "text-sm leading-6",
        isError ? "text-alert-signal" : "text-muted-readable",
      ].join(" ")}
      role={isError ? "alert" : "status"}
    >
      {message}
    </p>
  );
}
