"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { createWebDailyBriefClient, type DailyBriefClient } from "@/lib/ui/daily-brief";
import {
  AI_APPROVE_LABEL, AI_DECLINE_LABEL, AI_DECLINE_NOTE, AI_FEATURE_COPY, AI_FEATURES_INTRO, AI_FEATURES_TITLE,
  AI_PROVIDER_LINE, AI_SOURCE_COPY, AI_SOURCES_HEADING,
} from "@/lib/ui/ai-features-copy";

type Phase = "loading" | "ask" | "answered";

/**
 * Advisor plan Phase 4, workstream 4F (owner decision D2). The one AI features question
 * at first run. It shows on Timeline, in the first-run setup pop-up's place, until the
 * person answers it once: Continue turns every AI feature and source on; "Keep AI
 * features off" turns every feature off. Either answer is stored on the account, so it
 * never shows again on any device. Changes after that live in Settings > AI features.
 *
 * Accounts that already existed see it once on their next open. A failed read, or a
 * server without the 4F migration, shows the setup pop-up instead.
 */
export function AiFeaturesApproval({ client, children }: Readonly<{ client?: DailyBriefClient; children?: ReactNode }>) {
  const resolvedClient = useMemo(() => client ?? createWebDailyBriefClient(), [client]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void resolvedClient.preferences(controller.signal).then((settings) => {
      if (!controller.signal.aborted) setPhase(settings.ai && !settings.ai.approved ? "ask" : "answered");
    }).catch(() => {
      if (!controller.signal.aborted) setPhase("answered");
    });
    return () => controller.abort();
  }, [resolvedClient]);

  if (phase === "loading") return null;
  if (phase === "answered") return <>{children}</>;

  const answer = (approval: "all_on" | "all_off") => {
    setSaving(true); setError("");
    void resolvedClient.updatePreferences({ approval }).then((updated) => {
      // The Daily Brief launcher reads this and starts today's brief when it is on.
      window.dispatchEvent(new CustomEvent("cadence:daily-brief-settings", { detail: updated }));
      setPhase("answered");
    }).catch(() => {
      setError("Your answer could not be saved. Try again.");
    }).finally(() => setSaving(false));
  };

  const row = (key: string, title: string, does: string, without: string, state: string) => (
    <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-3">
      <span className="text-base leading-6 text-foreground">{title}</span>
      <span className="text-sm leading-6 text-muted-readable">{state}</span>
      <p className="col-span-2 text-sm leading-6 text-muted-readable">
        {does}
        {without ? <> If you turn it off: {lowerFirst(without)}</> : null}
      </p>
    </li>
  );

  return (
    <section
      role="dialog"
      aria-labelledby="ai-features-approval-title"
      aria-modal="false"
      className="fixed left-4 right-4 top-[calc(4rem+max(0.75rem,env(safe-area-inset-top)))] z-30 max-h-[calc(100dvh-5.5rem)] overflow-y-auto border border-line bg-background text-foreground sm:left-auto sm:right-6 sm:w-[min(28rem,calc(100vw-2rem))] lg:top-6 lg:max-h-[calc(100dvh-3rem)]"
    >
      <div className="border-b border-line p-4">
        <h2 id="ai-features-approval-title" className="text-xl leading-tight">{AI_FEATURES_TITLE}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-readable">{AI_FEATURES_INTRO}</p>
      </div>
      <ul className="divide-y divide-line px-4" aria-label={AI_FEATURES_TITLE}>
        {(["dailyBrief", "tips", "chat"] as const).map((key) =>
          row(key, AI_FEATURE_COPY[key].title, AI_FEATURE_COPY[key].does, AI_FEATURE_COPY[key].without, "On"))}
      </ul>
      <h3 className="border-t border-line px-4 pt-4 text-base font-bold leading-tight">{AI_SOURCES_HEADING}</h3>
      <ul className="divide-y divide-line px-4" aria-label={AI_SOURCES_HEADING}>
        {row("history", AI_SOURCE_COPY.history.title, AI_SOURCE_COPY.history.does, "", "Always")}
        {(["notes", "reminderHistory", "connected"] as const).map((key) =>
          row(key, AI_SOURCE_COPY[key].title, AI_SOURCE_COPY[key].does, AI_SOURCE_COPY[key].without, "On"))}
      </ul>
      <p className="border-t border-line px-4 py-3 text-sm leading-6 text-muted-readable">{AI_PROVIDER_LINE}</p>
      {/* The answer stays in view while the list scrolls. */}
      <div className="sticky bottom-0 grid gap-1 border-t border-line bg-background px-4 py-3 text-sm leading-6">
        <div className="flex flex-wrap items-center gap-x-6">
          <button type="button" disabled={saving} onClick={() => answer("all_on")} className="product-action product-action-primary min-h-11 py-2 underline underline-offset-2">
            {AI_APPROVE_LABEL}
          </button>
          <button type="button" disabled={saving} onClick={() => answer("all_off")} className="product-action product-action-secondary min-h-11 py-2">
            {AI_DECLINE_LABEL}
          </button>
        </div>
        <p className="text-muted-readable">{saving ? "Saving…" : AI_DECLINE_NOTE}</p>
        {error ? <p role="alert" className="text-accent">{error}</p> : null}
      </div>
    </section>
  );
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}
