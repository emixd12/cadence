"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { DailyBriefRequestError, createWebDailyBriefClient, type DailyBriefClient, type DailyBriefPreferenceInput } from "@/lib/ui/daily-brief";
import { SettingsPanel } from "@/components/settings/SettingsPanels";

/** Ticket 226: each new source has its own default-off disclosure, separate from connecting or showing it on Timeline. */
const CONNECTOR_DISCLOSURES = [
  {
    key: "includeOutlookCalendar", offer: "outlookCalendar", id: "daily-brief-outlook-disclosure", source: "Outlook Calendar", calendar: true,
    label: "Include selected Outlook Calendar timing",
    detail: "Sends today’s event times, availability and your response for the selected Outlook calendars. Event titles and details are not sent. Showing Outlook on Timeline does not turn this on.",
  },
  {
    key: "includeIcloudCalendar", offer: "icloudCalendar", id: "daily-brief-icloud-disclosure", source: "iCloud Calendar", calendar: true,
    label: "Include selected iCloud Calendar timing",
    detail: "Sends today’s event times and availability for the selected iCloud calendars. Event titles and details are not sent. Showing iCloud on Timeline does not turn this on.",
  },
  {
    key: "includeHevy", offer: "hevy", id: "daily-brief-hevy-disclosure", source: "Hevy", calendar: false,
    label: "Include today’s recorded Hevy workout times",
    detail: "Sends the start and end times of workouts already recorded today. Exercises, sets, weights, notes and titles are not sent. A workout never completes a Behavior or shows when you are free.",
  },
] as const;

type ConnectorDisclosure = (typeof CONNECTOR_DISCLOSURES)[number];
type SourceAttention = NonNullable<NonNullable<DailyBriefSettings["connectorAttention"]>["hevy"]>;

const ATTENTION_COPY: Readonly<Record<SourceAttention, (source: string, calendar: boolean) => string>> = {
  changed: (source, calendar) => `${source} was reconnected${calendar ? " or its selected calendars changed" : ""} after you allowed it, so the brief cannot use it until you allow it again.`,
  no_calendars: (source) => `No ${source} calendars are selected, so the brief cannot use it. Choose calendars in Connectors, or turn this off.`,
  unavailable: (source) => `${source} is not connected, so the brief cannot use it. Turn this off or reconnect ${source} in Connectors.`,
};

/** Server-reported reason; servers without it imply unavailable for a disclosed source they do not offer. */
function attentionOf(settings: DailyBriefSettings, source: ConnectorDisclosure): SourceAttention | null {
  const reported = settings.connectorAttention?.[source.offer];
  if (reported !== undefined) return reported;
  return settings[source.key] === true && settings.connectorSources?.[source.offer] !== true ? "unavailable" : null;
}

/**
 * A disclosed source the brief cannot use is sent off on any save that does not
 * name it. Saving another choice never renews a changed source's permission and
 * never fails because an unrelated source is unavailable.
 */
function needsAttention(settings: DailyBriefSettings, source: ConnectorDisclosure): boolean {
  return attentionOf(settings, source) !== null;
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

  const save = (change: Partial<DailyBriefPreferenceInput>) => {
    if (!settings) return;
    const enabled = change.enabled ?? settings.enabled;
    // Turning Daily Brief off revokes every optional disclosure with it.
    const next: DailyBriefPreferenceInput = {
      enabled,
      includeCalendar: enabled && (change.includeCalendar ?? settings.includeCalendar),
      includeReminderHistory: enabled && (change.includeReminderHistory ?? settings.includeReminderHistory === true),
      includeNotes: enabled && (change.includeNotes ?? settings.includeNotes === true),
      // Only servers that report connector sources accept these keys; older servers keep the four-key save.
      ...(settings.connectorSources ? Object.fromEntries(CONNECTOR_DISCLOSURES.map((source) => [source.key,
        enabled && (change[source.key] ?? (settings[source.key] === true && !needsAttention(settings, source)))])) : {}),
    };
    setSaving(true); setError("");
    void resolvedClient.updatePreferences(next).then((updated) => {
      setSettings(updated);
      localStorage.setItem("cadence.daily-brief.settings-revision.v1", `${updated.accountRef}:${updated.revision}`);
      window.dispatchEvent(new CustomEvent("cadence:daily-brief-settings", { detail: updated }));
    }).catch((failure: unknown) => {
      setError(!(failure instanceof DailyBriefRequestError) ? "Daily Brief settings are unavailable."
        : failure.code === "source_unavailable" ? "That source is not connected or has no selected calendar, so Cadence could not allow it. Check Connectors, then try again."
          : "Cadence could not save Daily Brief settings.");
    }).finally(() => setSaving(false));
  };

  return (
    <SettingsPanel title="Daily Brief" description="Cadence can prepare one read-only briefing when you first open Timeline each day.">
      {!settings ? <p role="status" className="text-sm text-muted-readable">{error || "Loading Daily Brief settings…"}</p> : !settings.available ? <p className="text-sm leading-6 text-muted-readable">Daily Brief is unavailable because this Cadence server has no configured model.</p> : <div className="grid gap-3 text-sm leading-6">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={(event) => save({ enabled: event.target.checked })} />
          <span>Enable Daily Brief</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={settings.includeCalendar} disabled={!settings.enabled || saving} onChange={(event) => save({ includeCalendar: event.target.checked })} />
          <span>Include selected Google Calendar timing</span>
        </label>
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
        {settings.connectorSources ? CONNECTOR_DISCLOSURES.map((source) => {
          const offered = settings.connectorSources?.[source.offer] === true;
          const checked = settings[source.key] === true;
          // A disclosure for a disconnected source stays visible so it can be turned off.
          if (!offered && !checked) return null;
          const attention = checked ? attentionOf(settings, source) : null;
          return <div key={source.key}>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={checked} disabled={!settings.enabled || saving} aria-describedby={source.id} onChange={(event) => save({ [source.key]: event.target.checked })} />
              <span>{source.label}</span>
            </label>
            <p id={source.id} className="max-w-2xl pl-7 text-muted-readable">{source.detail}{attention ? ` ${ATTENTION_COPY[attention](source.source, source.calendar)}` : ""}</p>
            {attention === "changed" ? <div className="pl-7 pt-2">
              <button type="button" className="product-action product-action-secondary min-h-11" disabled={!settings.enabled || saving} aria-describedby={source.id} onClick={() => save({ [source.key]: true })}>Allow {source.source} again</button>
            </div> : null}
          </div>;
        }) : null}
        <p className="max-w-2xl text-muted-readable">Cadence sends today’s Behavior schedule and completion history, including findings calculated from it, to OpenAI. Calendar timing, recorded workouts and the sources above are optional, and each needs its own choice here. The briefing cannot change tracking or Calendar records. <a className="underline underline-offset-2" href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI data retention may apply.</a></p>
        {desktop ? <p className="max-w-2xl text-muted-readable">Hosted context does not include unsynchronized or local-only desktop data.</p> : null}
        {error ? <p role="alert" className="text-accent">{error}</p> : null}
      </div>}
    </SettingsPanel>
  );
}
