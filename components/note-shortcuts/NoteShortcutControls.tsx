"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type {
  NoteShortcutCommand,
  NoteShortcutView,
} from "@cadence/core/types/note-shortcut";
import { noteShortcutRevision } from "@cadence/core/resolvers/note-suggestion.resolver";
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

export function NoteShortcutSettings({
  behaviorId,
  view,
  action,
}: Readonly<{
  behaviorId: string;
  view: NoteShortcutView;
  action: NoteShortcutAction;
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
  // Ticket 305: on for every active Behavior unless the retained account switch is off.
  const canUseSuggestions = Boolean(currentView.globalEnabled && currentView.available);
  const proposed = canUseSuggestions
    ? currentView.entries.filter((entry) => entry.status === "proposed")
    : [];

  return (
    <section className="border-t border-line pt-4" aria-labelledby={`note-shortcuts-${behaviorId}`} aria-busy={pending}>
      <DesktopDraftGuard pending={pending} />
      <h3 id={`note-shortcuts-${behaviorId}`} className="text-lg leading-tight">Note shortcuts</h3>
      {currentView.unavailable ? <p role="status" className="mt-2 text-sm leading-6">Note shortcuts are temporarily unavailable. You can still write and save Notes. Refresh to try again.</p> : null}
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-readable">
        When you save the same Note on three Occurrences of this Behavior, Cadence suggests it here. Accept a suggestion to show it above the Note field.
      </p>
      <p role={result.status === "error" ? "alert" : "status"} aria-live={result.status === "error" ? "assertive" : "polite"} className="mt-2 text-sm leading-6">
        {pending ? "Saving Note shortcuts…" : result.message}
      </p>
      {!currentView.globalEnabled && !currentView.unavailable ? <p className="mt-3 text-sm leading-6 text-muted-readable">Note shortcuts are turned off for this account. Your Notes and accepted shortcuts stay saved.</p> : null}
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

// Not rendered since Ticket 305: Note shortcuts are on by default and Settings shows no
// control. The stored account switch and this control stay so the switch can return.
export function GlobalNoteShortcutControl({ view, action }: Readonly<{ view: NoteShortcutView; action: NoteShortcutAction }>) {
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
  </section>;
}
