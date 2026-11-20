"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyBriefConnectedSource, DailyBriefSettings, DailyBriefSourceStatus } from "@cadence/core/types/daily-brief";
import { NO_DAILY_BRIEF_SOURCES } from "@cadence/core/services/daily-brief-sources";

import { createWebDailyBriefClient, type AiSettingsInput, type DailyBriefClient, type DailyBriefPreferenceInput, type DailyBriefSettingsUpdate } from "@/lib/ui/daily-brief";
import {
  AI_FEATURE_COPY, AI_FEATURES_TITLE, AI_PROVIDER_LINE, AI_SETTINGS_APPROVE_LABEL, AI_SOURCE_COPY, AI_SOURCES_HEADING,
  AI_UNANSWERED_LINE, AI_DECLINE_LABEL, aiOffLine, type AiFeatureCopyKey,
} from "@/lib/ui/ai-features-copy";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { useReportSettingsSection } from "@/components/settings/SettingsSections";
import { dailyBriefSectionState, settingsSectionLoad } from "@/lib/ui/settings-sections";

/**
 * Ticket 306: one choice covers every connected source, including one connected
 * later. "Choose sources" lists each connected source so it can be excluded. Since
 * advisor 4F the choice is shared by every AI feature.
 */
const SOURCES = [
  {
    key: "googleCalendar", id: "daily-brief-google-disclosure", title: "Google Calendar", calendar: true,
    // Ticket 307: the Timeline connection and its selected calendars.
    detail: "Event times, availability and your response for the calendars you selected for Timeline. Chat also reads event titles and locations.",
  },
  {
    key: "outlookCalendar", id: "daily-brief-outlook-disclosure", title: "Outlook Calendar", calendar: true,
    detail: "Event times, availability and your response for the selected Outlook calendars. Chat also reads event titles and locations.",
  },
  {
    key: "icloudCalendar", id: "daily-brief-icloud-disclosure", title: "iCloud Calendar", calendar: true,
    detail: "Event times and availability for the selected iCloud calendars. Chat also reads event titles and locations.",
  },
  {
    key: "hevy", id: "daily-brief-hevy-disclosure", title: "Hevy", calendar: false,
    detail: "Start and end times of workouts you recorded. Exercises, sets and weights are not used.",
  },
] as const satisfies readonly Readonly<{ key: DailyBriefConnectedSource; id: string; title: string; calendar: boolean; detail: string }>[];

type SourceChange = Partial<Omit<AiSettingsInput, "excludedSources">> & { exclude?: Readonly<{ source: DailyBriefConnectedSource; excluded: boolean }> };

function statusOf(settings: DailyBriefSettings, source: DailyBriefConnectedSource): DailyBriefSourceStatus {
  return settings.sourceStatus?.[source] ?? "not_connected";
}

function names(titles: readonly string[]): string {
  return titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/** The line under the one choice: the connected sources it covers, or why it covers none. */
function coverageLine(settings: DailyBriefSettings): string {
  const excluded = settings.excludedSources ?? NO_DAILY_BRIEF_SOURCES;
  const connected = SOURCES.filter((source) => statusOf(settings, source.key) !== "not_connected");
  if (!connected.length) return "Nothing is connected yet. Connect a calendar or Hevy in Connected sources, and this choice covers it.";
  const covered = connected.filter((source) => !excluded[source.key]);
  if (!covered.length) return "Every connected source is excluded under Choose sources. A source you connect later is covered.";
  return `Covers ${names(covered.map((source) => source.title))}, and any source you connect later.`;
}

/** What an Advanced row says about its source: used now, or why the brief cannot use it. */
function sourceState(settings: DailyBriefSettings, source: (typeof SOURCES)[number]): string {
  const excluded = settings.excludedSources?.[source.key] === true;
  if (settings.useConnectedSources !== true || excluded) return "";
  return statusOf(settings, source.key) === "no_calendars"
    ? ` No ${source.title} calendars are selected, so AI features cannot use it. Choose calendars in Connected sources.`
    : " AI features use it.";
}

/**
 * Advisor 4F (owner decision D2): Settings > AI features. One switch per AI feature
 * (Daily Brief, Advisor tips, Chat) and one set of source choices shared by all of
 * them. Each switch says what it does, or what is lost while it is off. Saving any
 * choice also answers the AI features question. The export keeps its Ticket 306
 * name because the web and the Mac both mount it.
 */
export function DailyBriefSettingsPanel({ client, desktop = false }: Readonly<{ client?: DailyBriefClient | null; desktop?: boolean }>) {
  const resolvedClient = useMemo(() => client === undefined ? createWebDailyBriefClient() : client, [client]);
  const [settings, setSettings] = useState<DailyBriefSettings>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Ticket 301: the drawer shows this state while closed. A failed save keeps the loaded settings.
  useReportSettingsSection(resolvedClient ? dailyBriefSectionState(settingsSectionLoad(settings, error !== "")) : null);

  useEffect(() => {
    if (!resolvedClient) return;
    const controller = new AbortController();
    void resolvedClient.preferences(controller.signal).then((value) => {
      if (!controller.signal.aborted) setSettings(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("AI settings could not load. Reload Settings to try again.");
    });
    return () => controller.abort();
  }, [resolvedClient]);

  if (!resolvedClient || (desktop && !navigator.onLine)) {
    return <SettingsPanel title={AI_FEATURES_TITLE} description="AI features need a linked Cadence account and an internet connection. Tracking works offline."><p className="sr-only">AI features are unavailable.</p></SettingsPanel>;
  }

  const send = (next: DailyBriefSettingsUpdate) => {
    setSaving(true); setError("");
    void resolvedClient.updatePreferences(next).then((updated) => {
      setSettings(updated);
      localStorage.setItem("cadence.daily-brief.settings-revision.v1", `${updated.accountRef}:${updated.revision}`);
      window.dispatchEvent(new CustomEvent("cadence:daily-brief-settings", { detail: updated }));
    }).catch(() => {
      setError("AI settings could not save. Your change was undone. Try again.");
    }).finally(() => setSaving(false));
  };

  const save = (change: SourceChange) => {
    if (!settings) return;
    const excluded = settings.excludedSources ?? NO_DAILY_BRIEF_SOURCES;
    const enabled = change.enabled ?? settings.enabled;
    if (!settings.ai) {
      // A server before 4F: turning Daily Brief off withdraws every source choice with it.
      const legacy: DailyBriefPreferenceInput = {
        enabled,
        useConnectedSources: enabled && (change.useConnectedSources ?? settings.useConnectedSources === true),
        excludedSources: !enabled ? NO_DAILY_BRIEF_SOURCES : change.exclude ? { ...excluded, [change.exclude.source]: change.exclude.excluded } : excluded,
        includeReminderHistory: enabled && (change.includeReminderHistory ?? settings.includeReminderHistory === true),
        includeNotes: enabled && (change.includeNotes ?? settings.includeNotes === true),
      };
      send(legacy);
      return;
    }
    send({
      enabled,
      tipsEnabled: change.tipsEnabled ?? settings.ai.tipsEnabled,
      chatEnabled: change.chatEnabled ?? settings.ai.chatEnabled,
      useConnectedSources: change.useConnectedSources ?? settings.useConnectedSources === true,
      excludedSources: change.exclude ? { ...excluded, [change.exclude.source]: change.exclude.excluded } : excluded,
      includeReminderHistory: change.includeReminderHistory ?? settings.includeReminderHistory === true,
      includeNotes: change.includeNotes ?? settings.includeNotes === true,
    });
  };

  const connected = settings ? SOURCES.filter((source) => statusOf(settings, source.key) !== "not_connected") : [];
  const useSources = !!settings && settings.useConnectedSources === true && (!!settings.ai || settings.enabled);
  // Before 4F a source choice needs Daily Brief on; since 4F it stands on its own.
  const sourcesLocked = !!settings && !settings.ai && !settings.enabled;
  const feature = (key: AiFeatureCopyKey, on: boolean, change: SourceChange, available = true) => {
    const copy = AI_FEATURE_COPY[key];
    const id = `ai-feature-${key}`;
    return <div key={key}>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={on} disabled={saving || !available} aria-describedby={id} onChange={() => save(change)} />
        <span>{copy.title}</span>
      </label>
      <p id={id} className="max-w-2xl pl-7 text-muted-readable">{!available ? "This Cadence server does not offer it." : on ? copy.does : aiOffLine(copy.without)}</p>
    </div>;
  };
  const source = (key: "notes" | "reminderHistory", on: boolean, change: SourceChange) => {
    const copy = AI_SOURCE_COPY[key];
    const id = `ai-source-${key}`;
    return <div key={key}>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={on} disabled={saving || sourcesLocked} aria-describedby={id} onChange={() => save(change)} />
        <span>{copy.title}</span>
      </label>
      <p id={id} className="max-w-2xl pl-7 text-muted-readable">{on ? copy.does : aiOffLine(copy.without)}</p>
    </div>;
  };

  return (
    <SettingsPanel title={AI_FEATURES_TITLE}>
      {!settings ? <p role="status" className="text-sm text-muted-readable">{error || "Loading AI settings…"}</p> : <div className="grid gap-3 text-sm leading-6">
        {settings.ai && !settings.ai.approved ? <div className="grid gap-2">
          <p className="max-w-2xl">{AI_UNANSWERED_LINE}</p>
          <p className="flex flex-wrap gap-x-5">
            <button type="button" className="min-h-11 underline underline-offset-2" disabled={saving} onClick={() => send({ approval: "all_on" })}>{AI_SETTINGS_APPROVE_LABEL}</button>
            <button type="button" className="min-h-11 text-muted-readable underline underline-offset-2" disabled={saving} onClick={() => send({ approval: "all_off" })}>{AI_DECLINE_LABEL}</button>
          </p>
        </div> : null}
        {feature("dailyBrief", settings.available && settings.enabled, { enabled: !settings.enabled }, settings.available)}
        {settings.ai ? feature("tips", settings.ai.tipsEnabled, { tipsEnabled: !settings.ai.tipsEnabled }) : null}
        {settings.ai ? feature("chat", settings.ai.chatEnabled, { chatEnabled: !settings.ai.chatEnabled }) : null}
        <h4 className="pt-3 text-base font-bold leading-tight">{AI_SOURCES_HEADING}</h4>
        <div>
          <p className="min-h-11 py-2.5 pl-7">{AI_SOURCE_COPY.history.title}</p>
          <p className="max-w-2xl pl-7 text-muted-readable">{AI_SOURCE_COPY.history.does}</p>
        </div>
        {/* Notes and reminder history are shared by every AI feature, so they always show once the AI settings exist. */}
        {settings.ai || settings.optionalSources?.notes !== false ? source("notes", settings.includeNotes === true, { includeNotes: settings.includeNotes !== true }) : null}
        {settings.ai || settings.optionalSources?.reminders !== false ? source("reminderHistory", settings.includeReminderHistory === true, { includeReminderHistory: settings.includeReminderHistory !== true }) : null}
        <div>
          <label className="flex min-h-11 items-center gap-3">
            {/* With nothing connected the choice can still be turned off, never on. */}
            <input type="checkbox" checked={useSources} disabled={sourcesLocked || saving || (!useSources && connected.length === 0)} aria-describedby="daily-brief-sources-coverage" onChange={(event) => save({ useConnectedSources: event.target.checked })} />
            <span>{AI_SOURCE_COPY.connected.title}</span>
          </label>
          <p id="daily-brief-sources-coverage" className="max-w-2xl pl-7 text-muted-readable">{useSources ? `${AI_SOURCE_COPY.connected.does} ${coverageLine(settings)}` : connected.length ? aiOffLine(AI_SOURCE_COPY.connected.without) : coverageLine(settings)}</p>
        </div>
        {connected.length > 0 ? <details className="grid gap-3 pl-7">
          <summary className="product-disclosure-trigger product-action product-action-secondary min-h-11 w-fit">Choose sources</summary>
          <div className="grid gap-3 pt-2">
            {connected.map((item) => <div key={item.key}>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={useSources && settings.excludedSources?.[item.key] !== true} disabled={!useSources || saving} aria-describedby={item.id}
                  onChange={(event) => save({ exclude: { source: item.key, excluded: !event.target.checked } })} />
                <span>{item.title}</span>
              </label>
              <p id={item.id} className="max-w-2xl pl-7 text-muted-readable">{item.detail}{sourceState(settings, item)}</p>
            </div>)}
          </div>
        </details> : null}
        <p className="max-w-2xl pt-2 text-muted-readable">{AI_PROVIDER_LINE} <a className="underline underline-offset-2" href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI data retention may apply.</a></p>
        {desktop ? <p className="max-w-2xl text-muted-readable">Hosted context does not include unsynchronized or local-only desktop data.</p> : null}
        {error ? <p role="alert" className="text-accent">{error}</p> : null}
      </div>}
    </SettingsPanel>
  );
}
