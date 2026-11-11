"use client";

import { useEffect, useId, useState, useTransition } from "react";

import type { SourceLinkFormState, SourceLinkMode, SourceLinkSaveResult } from "@/lib/services/source-links.service";
import { webSourceLinkCoordinator, type SourceLinkCoordinator } from "@/lib/ui/source-links";

// Ticket 317 (D28.3, D28.4): "Complete from Hevy" for one Behavior. Shown only when
// connector completion is available and Hevy is connected. Off by default. Leads with
// the routine picker; "Any workout" is the fallback. Saving is its own step, beside
// the Behavior form, because the link is a separate hosted record.

type LoadState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "error" }>
  | Readonly<{ kind: "ready"; state: SourceLinkFormState }>;

export function SourceLinkSettings({
  behaviorId,
  coordinator = webSourceLinkCoordinator,
}: Readonly<{ behaviorId: string; coordinator?: SourceLinkCoordinator }>) {
  const id = useId();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [mode, setMode] = useState<SourceLinkMode>("off");
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<Readonly<{ tone: "status" | "alert"; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void coordinator.getState(behaviorId).then((state) => {
      if (!active) return;
      if (!state.available || !state.connected) { setLoad({ kind: "hidden" }); return; }
      setLoad({ kind: "ready", state });
      setMode(state.mode);
      setKeys(state.selectorKeys);
    }).catch((error: unknown) => {
      if (!active) return;
      // Signed out, not configured or no network: show nothing, as when Hevy is not connected.
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      setLoad(code === "provider_unavailable" ? { kind: "error" } : { kind: "hidden" });
    });
    return () => { active = false; };
  }, [behaviorId, coordinator]);

  if (load.kind === "hidden" || load.kind === "loading") return null;
  if (load.kind === "error") {
    return <section className="border-t border-line pt-4" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-lg leading-tight">Complete from Hevy</h3>
      <p role="status" className="mt-2 text-sm leading-6">Hevy link settings are unavailable. Tracking is unaffected. Refresh to try again.</p>
    </section>;
  }

  const state = load.state;
  const anyTaken = state.anyHolder !== null;
  const chosen = new Set(keys);
  const canSave = !pending && (mode !== "routines" || keys.length > 0);
  const toggle = (key: string) => setKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);

  function save() {
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await coordinator.save({ behaviorId, mode, selectorKeys: mode === "routines" ? keys : [] });
        setMessage(saveMessage(result));
      } catch {
        setMessage({ tone: "alert", text: "The Hevy link was not saved. Try again." });
      }
    });
  }

  return (
    <section className="border-t border-line pt-4" aria-labelledby={`${id}-heading`} aria-busy={pending} data-source-link="hevy">
      <h3 id={`${id}-heading`} className="text-lg leading-tight">Complete from Hevy</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-readable">
        A matching workout marks this Behavior Completed on the workout&apos;s day. It never changes a status you set, and each
        completion is labeled &ldquo;From Hevy&rdquo;.
      </p>
      {state.fenced ? <p className="mt-2 max-w-2xl text-sm leading-6" role="status">
        This link was saved for a different Hevy account. Save it again to use the connected account.
      </p> : null}
      <fieldset className="mt-3 grid gap-2 border-0 p-0 text-sm">
        <legend className="sr-only">Complete from Hevy</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name={`${id}-mode`} checked={mode === "off"} onChange={() => setMode("off")} disabled={pending}
            className="h-4 w-4 accent-[var(--primary)]" />
          Off
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name={`${id}-mode`} checked={mode === "routines"} onChange={() => setMode("routines")} disabled={pending}
            className="h-4 w-4 accent-[var(--primary)]" />
          Chosen routines
        </label>
        {mode === "routines" ? <div className="grid gap-1 pl-7" data-source-link-routines>
          {state.routinesComplete === null ? <p className="text-muted-readable">Hevy routines could not be read. Try again later.</p> : null}
          {state.routinesComplete !== null && state.routines.length === 0 ? <p className="text-muted-readable">No routines in Hevy yet. Use Any workout, or create a routine in Hevy.</p> : null}
          {state.routines.map((routine) => {
            const held = routine.holder !== null;
            return <label key={routine.key} className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={chosen.has(routine.key)} disabled={pending || held} onChange={() => toggle(routine.key)}
                className="h-4 w-4 accent-[var(--primary)]" />
              <span className="min-w-0 break-words">
                {routine.title}
                {held ? <span className="text-muted-readable"> · linked to {routine.holder!.title}</span> : null}
              </span>
            </label>;
          })}
          {state.routinesComplete === false ? <p className="text-muted-readable">Showing the first 200 routines from Hevy.</p> : null}
          {state.staleLinkedCount ? <p className="text-muted-readable" data-stale-routines>
            {state.staleLinkedCount === 1 ? "1 linked routine is no longer in Hevy." : `${state.staleLinkedCount} linked routines are no longer in Hevy.`}
          </p> : null}
          {state.anyHolder ? <p className="text-muted-readable" data-any-holder-note>
            A workout from these routines also counts for {state.anyHolder.title}, which is linked to any workout.
          </p> : null}
        </div> : null}
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name={`${id}-mode`} checked={mode === "any"} onChange={() => setMode("any")} disabled={pending || anyTaken}
            className="h-4 w-4 accent-[var(--primary)]" />
          <span>
            Any workout
            {anyTaken ? <span className="text-muted-readable"> · linked to {state.anyHolder!.title}. One Behavior can use any workout.</span> : null}
          </span>
        </label>
      </fieldset>
      <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-5">
        <button type="button" onClick={save} disabled={!canSave}
          className="product-action product-action-secondary min-h-11 justify-self-start px-3 py-2 text-sm font-bold">
          {pending ? "Saving Hevy link…" : "Save Hevy link"}
        </button>
        <p role={message?.tone === "alert" ? "alert" : "status"} className="leading-6">{message?.text ?? ""}</p>
      </div>
    </section>
  );
}

export function saveMessage(result: SourceLinkSaveResult): Readonly<{ tone: "status" | "alert"; text: string }> {
  if (result.saved) {
    return { tone: "status", text: result.mode === "off" ? "Hevy link turned off. Past completions stay." : "Hevy link saved. Matching workouts from the last 30 days count on their days." };
  }
  if (result.reason === "selector_already_linked") {
    return { tone: "alert", text: `A chosen routine is already linked to ${result.holder?.title ?? "another Behavior"}. A routine can complete one Behavior.` };
  }
  if (result.reason === "any_link_exists") {
    return { tone: "alert", text: `${result.holder?.title ?? "Another Behavior"} already uses any workout. Use one Behavior with two times instead.` };
  }
  if (result.reason === "source_not_connected") return { tone: "alert", text: "Connect Hevy in Settings first." };
  return { tone: "alert", text: "Those routines could not be saved. Choose them again." };
}
