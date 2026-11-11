"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyBriefConnectedSource, DailyBriefSettings, DailyBriefSourceStatus } from "@cadence/core/types/daily-brief";
import { NO_DAILY_BRIEF_SOURCES } from "@cadence/core/services/daily-brief-sources";

import { createWebDailyBriefClient, type DailyBriefClient, type DailyBriefPreferenceInput } from "@/lib/ui/daily-brief";
import { SettingsPanel } from "@/components/settings/SettingsPanels";

/**
 * Ticket 306: one choice covers every connected source, including one connected
 * later. Advanced lists each connected source so it can be excluded; each keeps
 * its statement of what is sent.
 */
const SOURCES = [
  {
    key: "googleCalendar", id: "daily-brief-google-disclosure", title: "Google Calendar", calendar: true,
    detail: "Sends today’s event times, timezone, availability and your response for the calendars selected in Google Calendar for Daily Brief. Event titles, descriptions, locations and attendees are not sent. Your Timeline Google Calendar connection is never used.",
  },
  {
    key: "outlookCalendar", id: "daily-brief-outlook-disclosure", title: "Outlook Calendar", calendar: true,
    detail: "Sends today’s event times, availability and your response for the selected Outlook calendars. Event titles and details are not sent.",
  },
  {
    key: "icloudCalendar", id: "daily-brief-icloud-disclosure", title: "iCloud Calendar", calendar: true,
    detail: "Sends today’s event times and availability for the selected iCloud calendars. Event titles and details are not sent.",
  },
  {
    key: "hevy", id: "daily-brief-hevy-disclosure", title: "Hevy", calendar: false,
    detail: "Sends the start and end times of workouts already recorded today. Exercises, sets, weights, notes and titles are not sent. A workout never completes a Behavior or shows when you are free.",
  },
] as const satisfies readonly Readonly<{ key: DailyBriefConnectedSource; id: string; title: string; calendar: boolean; detail: string }>[];

type SourceChange = Partial<Omit<DailyBriefPreferenceInput, "excludedSources">> & { exclude?: Readonly<{ source: DailyBriefConnectedSource; excluded: boolean }> };

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
  if (!connected.length) return "Nothing is connected yet. Connect a calendar or Hevy in Connectors, and this choice covers it.";
  const covered = connected.filter((source) => !excluded[source.key]);
  if (!covered.length) return "Every connected source is excluded under Advanced. A source you connect later is covered.";
  return `Covers ${names(covered.map((source) => source.title))}, and any source you connect later. Only timing is sent, never event titles, descriptions, locations, attendees or workout details.`;
}

/** What an Advanced row says about its source: used now, or why the brief cannot use it. */
function sourceState(settings: DailyBriefSettings, source: (typeof SOURCES)[number]): string {
  const excluded = settings.excludedSources?.[source.key] === true;
  if (!settings.enabled || settings.useConnectedSources !== true || excluded) return "";
  return statusOf(settings, source.key) === "no_calendars"
    ? ` No ${source.title} calendars are selected, so the brief cannot use it. Choose calendars in Connectors.`
    : " Daily Brief uses it.";
}

export function DailyBriefSettingsPanel({ client, desktop = false }: Readonly<{ client?: DailyBriefClient | null; desktop?: boolean }>) {
  const resolvedClient = useMemo(() => client === undefined ? createWebDailyBriefClient() : client, [client]);
  const [settings, setSettings] = useState<DailyBriefSettings>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!resolvedClient) return;
    const controller = new AbortController();
    void resolvedClient.preferences(controller.signal).then((value) => {
      if (!controller.signal.aborted) setSettings(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Daily Brief settings are unavailable.");
    });
    return () => controller.abort();
  }, [resolvedClient]);

  if (!resolvedClient || (desktop && !navigator.onLine)) {
    return <SettingsPanel title="Daily Brief" description="Daily Brief is available only to linked, online desktop accounts. Local tracking remains available offline."><p className="sr-only">Daily Brief is unavailable.</p></SettingsPanel>;
  }

  const save = (change: SourceChange) => {
    if (!settings) return;
    const enabled = change.enabled ?? settings.enabled;
    const excluded = settings.excludedSources ?? NO_DAILY_BRIEF_SOURCES;
    // Turning Daily Brief off withdraws every source choice with it.
    const next: DailyBriefPreferenceInput = {
      enabled,
      useConnectedSources: enabled && (change.useConnectedSources ?? settings.useConnectedSources === true),
      excludedSources: !enabled ? NO_DAILY_BRIEF_SOURCES
        : change.exclude ? { ...excluded, [change.exclude.source]: change.exclude.excluded } : excluded,
      includeReminderHistory: enabled && (change.includeReminderHistory ?? settings.includeReminderHistory === true),
      includeNotes: enabled && (change.includeNotes ?? settings.includeNotes === true),
    };
    setSaving(true); setError("");
    void resolvedClient.updatePreferences(next).then((updated) => {
      setSettings(updated);
      localStorage.setItem("cadence.daily-brief.settings-revision.v1", `${updated.accountRef}:${updated.revision}`);
      window.dispatchEvent(new CustomEvent("cadence:daily-brief-settings", { detail: updated }));
    }).catch(() => {
      setError("Cadence could not save Daily Brief settings.");
    }).finally(() => setSaving(false));
  };

  const connected = settings ? SOURCES.filter((source) => statusOf(settings, source.key) !== "not_connected") : [];
  const advanced = !!settings && (connected.length > 0 || settings.optionalSources?.reminders === true || settings.optionalSources?.notes === true);
  const useSources = !!settings && settings.enabled && settings.useConnectedSources === true;

  return (
    <SettingsPanel title="Daily Brief" description="Cadence can prepare one read-only briefing when you first open Timeline each day.">
      {!settings ? <p role="status" className="text-sm text-muted-readable">{error || "Loading Daily Brief settings…"}</p> : !settings.available ? <p className="text-sm leading-6 text-muted-readable">Daily Brief is unavailable because this Cadence server has no configured model.</p> : <div className="grid gap-3 text-sm leading-6">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={(event) => save({ enabled: event.target.checked })} />
          <span>Daily Brief</span>
        </label>
        <div>
          <label className="flex min-h-11 items-center gap-3">
            {/* With nothing connected the choice can still be turned off, never on. */}
            <input type="checkbox" checked={useSources} disabled={!settings.enabled || saving || (!useSources && connected.length === 0)} aria-describedby="daily-brief-sources-coverage" onChange={(event) => save({ useConnectedSources: event.target.checked })} />
            <span>Plan around my connected sources</span>
          </label>
          <p id="daily-brief-sources-coverage" className="max-w-2xl pl-7 text-muted-readable">{coverageLine(settings)}</p>
        </div>
        {advanced ? <details className="grid gap-3">
          <summary className="product-disclosure-trigger product-action product-action-secondary min-h-11 w-fit">Advanced: choose sources</summary>
          <div className="grid gap-3 pt-2">
            {connected.map((source) => <div key={source.key}>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={useSources && settings.excludedSources?.[source.key] !== true} disabled={!useSources || saving} aria-describedby={source.id}
                  onChange={(event) => save({ exclude: { source: source.key, excluded: !event.target.checked } })} />
                <span>{source.title}</span>
              </label>
              <p id={source.id} className="max-w-2xl pl-7 text-muted-readable">{source.detail}{sourceState(settings, source)}</p>
            </div>)}
            {settings.optionalSources?.reminders ? <div>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={settings.includeReminderHistory === true} disabled={!settings.enabled || saving} aria-describedby="daily-brief-reminder-disclosure" onChange={(event) => save({ includeReminderHistory: event.target.checked })} />
                <span>Include reminder delivery history</span>
              </label>
              <p id="daily-brief-reminder-disclosure" className="max-w-2xl pl-7 text-muted-readable">Lets a tip compare outcomes with and without delivered reminders. Cadence sends only counts calculated from reminder send records, never reminder content.</p>
            </div> : null}
            {settings.optionalSources?.notes ? <div>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={settings.includeNotes === true} disabled={!settings.enabled || saving} aria-describedby="daily-brief-notes-disclosure" onChange={(event) => save({ includeNotes: event.target.checked })} />
                <span>Include Notes on Not Completed occurrences</span>
              </label>
              <p id="daily-brief-notes-disclosure" className="max-w-2xl pl-7 text-muted-readable">Lets a tip name a recurring obstacle. When a Notes pattern is selected as the tip, Cadence sends up to 12 Notes, the first 280 characters of each, from Not Completed occurrences in the last 90 days. Other Notes are never sent.</p>
            </div> : null}
          </div>
        </details> : null}
        <p className="max-w-2xl text-muted-readable">Cadence sends today’s Behavior schedule and completion history, including findings calculated from it, to OpenAI. Connected sources, reminder history and Notes are optional: nothing from them is sent unless a choice here covers it. The briefing cannot change tracking or Calendar records. <a className="underline underline-offset-2" href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI data retention may apply.</a></p>
        {desktop ? <p className="max-w-2xl text-muted-readable">Hosted context does not include unsynchronized or local-only desktop data.</p> : null}
        {error ? <p role="alert" className="text-accent">{error}</p> : null}
      </div>}
    </SettingsPanel>
  );
}
