"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import type {
  NoteShortcutCommand,
  NoteShortcutView,
} from "@cadence/core/types/note-shortcut";
import { noteShortcutRevision } from "@cadence/core/resolvers/note-suggestion.resolver";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import { DesktopDraftGuard } from "@/lib/desktop-draft";

export type NoteShortcutActionState = {
  status: "idle" | "success" | "error";
  message: string;
  view?: NoteShortcutView;
};

export type NoteShortcutAction = (
  behaviorId: string | null,
  command: NoteShortcutCommand,
  expectedRevision: string,
) => Promise<NoteShortcutActionState>;

type NoteShortcutCopy = Readonly<{
  title: string;
  description: string;
  enableLabel: string;
  analyzeLabel: string;
  globalOffHint: string;
}>;

const BEHAVIOR_SHORTCUT_COPY: NoteShortcutCopy = {
  title: "Note shortcuts",
  description: "Matching uses repeated Notes for this Behavior and runs only when you ask.",
  enableLabel: "Enable Note shortcuts for this Behavior",
  analyzeLabel: "Find repeated Notes",
  globalOffHint: "Enable Note shortcuts in Settings before finding repeated Notes.",
};

const DAY_NOTE_SHORTCUT_COPY: NoteShortcutCopy = {
  title: "Day note shortcuts",
  description: "Matching uses repeated day notes and runs only when you ask. These shortcuts appear only when you write a day note.",
  enableLabel: "Enable day note shortcuts",
  analyzeLabel: "Find repeated day notes",
  globalOffHint: "Enable Note shortcuts above before finding repeated day notes.",
};

/** Manages the day-note pool. Web passes a Server Action; desktop can pass a local callback. */
export function DayNoteShortcutSettings({
  view,
  action,
}: Readonly<{
  view: NoteShortcutView;
  action: NoteShortcutAction;
}>) {
  return <NoteShortcutSettings behaviorId={DAY_NOTE_SHORTCUT_POOL_ID} view={view} action={action} copy={DAY_NOTE_SHORTCUT_COPY} />;
}

export function NoteShortcutSettings({
  behaviorId,
  view,
  action,
  copy = BEHAVIOR_SHORTCUT_COPY,
}: Readonly<{
  behaviorId: string;
  view: NoteShortcutView;
  action: NoteShortcutAction;
  copy?: NoteShortcutCopy;
}>) {
  const [currentView, setCurrentView] = useState(view);
  const [result, setResult] = useState<NoteShortcutActionState>({
    status: "idle",
    message: "",
  });
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const seenParentViewRef = useRef(view);
  const queuedParentViewRef = useRef<NoteShortcutView | null>(null);

  useEffect(() => {
    if (seenParentViewRef.current !== view) {
      seenParentViewRef.current = view;
      queuedParentViewRef.current = view;
    }
    if (pending || editing || !queuedParentViewRef.current) return;
    const nextView = queuedParentViewRef.current;
    queuedParentViewRef.current = null;
    if (nextView === currentView) return;
    const timer = window.setTimeout(() => setCurrentView(nextView), 0);
    return () => window.clearTimeout(timer);
  }, [currentView, editing, pending, view]);

  function run(command: NoteShortcutCommand) {
    startTransition(async () => {
      const next = await action(behaviorId, command, noteShortcutRevision(currentView.state));
      setResult(next);
      if (next.view) setCurrentView(next.view);
      if (next.status === "success") setEditing(null);
    });
  }

  const accepted = currentView.entries.filter((entry) => entry.status === "accepted");
  const canUseSuggestions = Boolean(currentView.globalEnabled && currentView.available && currentView.state?.enabled);
  const proposed = canUseSuggestions
    ? currentView.entries.filter((entry) => entry.status === "proposed")
    : [];

  return (
    <section className="border-t border-line pt-4" aria-labelledby={`note-shortcuts-${behaviorId}`} aria-busy={pending}>
      <DesktopDraftGuard pending={pending} />
      <h3 id={`note-shortcuts-${behaviorId}`} className="text-lg leading-tight">{copy.title}</h3>
      {currentView.unavailable ? <p role="status" className="mt-2 text-sm leading-6">Note shortcuts are temporarily unavailable. You can still write and save Notes. Refresh to try again.</p> : null}
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-readable">
        {copy.description}
      </p>
      <p role={result.status === "error" ? "alert" : "status"} aria-live={result.status === "error" ? "assertive" : "polite"} className="mt-2 text-sm leading-6">
        {pending ? "Saving Note shortcuts…" : result.message}
      </p>
      {currentView.available ? <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={currentView.state?.enabled ?? false}
          disabled={pending}
          onChange={(event) => run({ operation: "enable", enabled: event.currentTarget.checked })}
        />
        {copy.enableLabel}
      </label> : null}
      {canUseSuggestions ? (
        <button type="button" disabled={pending} onClick={() => run({ operation: "analyze" })} className="product-action product-action-primary mt-3 min-h-11 py-2 text-sm">
          {copy.analyzeLabel}
        </button>
      ) : null}
      {!currentView.globalEnabled && !currentView.unavailable ? <p className="mt-3 text-sm leading-6 text-muted-readable">{copy.globalOffHint}</p> : null}
      {proposed.length > 0 ? <div className="mt-4 grid gap-3" aria-label="Proposed Note shortcuts">
        <h4 className="text-sm font-bold">Proposed</h4>
        {proposed.map((entry) => <ShortcutEditor key={entry.key} entry={entry} pending={pending} editing={editing === entry.key}
          onEdit={() => setEditing(entry.key)} onCancel={() => setEditing(null)}
          onAccept={(text) => run({ operation: "accept", key: entry.key, text })}
          onDismiss={() => run({ operation: "dismiss", key: entry.key })} />)}
      </div> : null}
      {accepted.length > 0 ? <div className="mt-4 grid gap-3" aria-label="Accepted Note shortcuts">
        <h4 className="text-sm font-bold">Accepted</h4>
        {accepted.map((entry) => <ShortcutEditor key={entry.key} entry={entry} pending={pending} editing={editing === entry.key}
          onEdit={() => setEditing(entry.key)} onCancel={() => setEditing(null)}
          onAccept={(text) => run({ operation: "edit", key: entry.key, text })}
          onDismiss={() => run({ operation: "remove", key: entry.key })} accepted editable={canUseSuggestions} />)}
      </div> : null}
    </section>
  );
}

function ShortcutEditor({ entry, accepted = false, editable = true, pending, editing, onEdit, onCancel, onAccept, onDismiss }: Readonly<{
  entry: NoteShortcutView["entries"][number];
  accepted?: boolean;
  editable?: boolean;
  pending: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onAccept: (text: string) => void;
  onDismiss: () => void;
}>) {
  const [text, setText] = useState(entry.text ?? "");
  const enterEdit = () => {
    setText(entry.text ?? "");
    onEdit();
  };
  const cancelEdit = () => {
    setText(entry.text ?? "");
    onCancel();
  };
  return <div className="grid gap-2 border-l border-line pl-3">
      <DesktopDraftGuard dirty={editing && text !== (entry.text ?? "")} onDiscard={cancelEdit} />
      {editing && editable ? <label className="grid gap-1 text-sm"><span className="sr-only">Shortcut text</span>
      <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} rows={2} className="min-h-11 border border-line bg-background px-3 py-2 text-base" />
    </label> : <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{entry.text}</p>}
    <div className="flex flex-wrap gap-3 text-sm">
      {editing ? <><button type="button" disabled={pending || !text.trim()} onClick={() => onAccept(text)} className="product-action product-action-primary min-h-11 py-2">{accepted ? "Save shortcut" : "Accept"}</button>
        <button type="button" disabled={pending} onClick={cancelEdit} className="product-action product-action-secondary min-h-11 py-2">Cancel</button></> : <>
        {!accepted ? <button type="button" disabled={pending} onClick={() => onAccept(text)} className="product-action product-action-primary min-h-11 py-2">Accept</button> : null}
        {editable ? <button type="button" disabled={pending} onClick={enterEdit} className="product-action product-action-secondary min-h-11 py-2">Edit</button> : null}
        <button type="button" disabled={pending} onClick={onDismiss} className="product-action product-action-secondary min-h-11 py-2">{accepted ? "Remove" : "Dismiss"}</button>
      </>}
    </div>
  </div>;
}

export function GlobalNoteShortcutControl({ view, action, children }: Readonly<{ view: NoteShortcutView; action: NoteShortcutAction; children?: ReactNode }>) {
  const [currentView, setCurrentView] = useState(view);
  const [result, setResult] = useState<NoteShortcutActionState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();
  const seenParentViewRef = useRef(view);
  const queuedParentViewRef = useRef<NoteShortcutView | null>(null);
  useEffect(() => {
    if (seenParentViewRef.current !== view) {
      seenParentViewRef.current = view;
      queuedParentViewRef.current = view;
    }
    if (pending || !queuedParentViewRef.current) return;
    const nextView = queuedParentViewRef.current;
    queuedParentViewRef.current = null;
    if (nextView === currentView) return;
    const timer = window.setTimeout(() => setCurrentView(nextView), 0);
    return () => window.clearTimeout(timer);
  }, [currentView, pending, view]);
  return <section id="note-shortcuts" className="scroll-mt-20 bg-background py-4" aria-labelledby="note-shortcuts-title" aria-busy={pending}>
    <DesktopDraftGuard pending={pending} />
    <h2 id="note-shortcuts-title" className="text-xl leading-tight">Note shortcuts</h2>
    {currentView.unavailable ? <p role="status" className="mt-2 text-sm leading-6">Note shortcuts are temporarily unavailable. You can still write and save Notes. Refresh to try again.</p> : null}
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">Turn off repeated-Note shortcuts everywhere. Existing Notes and accepted shortcuts stay saved.</p>
    <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" checked={currentView.globalEnabled} disabled={pending || currentView.unavailable} onChange={(event) => startTransition(async () => {
        const next = await action(null, { operation: "enable", enabled: event.currentTarget.checked }, noteShortcutRevision(currentView.state));
        setResult(next); if (next.view) setCurrentView(next.view);
      })} />
      Enable Note shortcuts
    </label>
    <p role={result.status === "error" ? "alert" : "status"} aria-live={result.status === "error" ? "assertive" : "polite"} className="mt-2 text-sm leading-6">{pending ? "Saving Note shortcuts…" : result.message}</p>
    {children ? <div className="mt-4">{children}</div> : null}
  </section>;
}
