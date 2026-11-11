import type { ReactNode } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { SettingsRow, SettingsSectionReport, SettingsSourceIcon } from "@/components/settings/SettingsSections";
import type { ConnectorProvider } from "@/lib/types/connectors";
import { connectorUnavailableSectionState, type SettingsSectionState } from "@/lib/ui/settings-sections";

export type ConnectorLibrarySourceId = "google_calendar" | ConnectorProvider;

/** One source row. Omit `content` when the source cannot be connected here. */
export type ConnectorLibrarySource = Readonly<{
  id: ConnectorLibrarySourceId;
  content?: ReactNode;
  unavailableReason?: string;
}>;

const SOURCE_ORDER: readonly ConnectorLibrarySourceId[] = ["google_calendar", "outlook_calendar", "icloud_calendar", "hevy"];
/** Each icon is the provider's own asset, bundled unchanged (`public/brand/connector-icons-source.md`). */
const SOURCE_DETAILS: Readonly<Record<ConnectorLibrarySourceId, Readonly<{ name: string; kind: string; icon: string }>>> = {
  google_calendar: { name: "Google Calendar", kind: "Calendar", icon: "/brand/google-calendar.svg" },
  outlook_calendar: { name: "Outlook Calendar", kind: "Calendar", icon: "/brand/outlook-calendar.svg" },
  icloud_calendar: { name: "iCloud Calendar", kind: "Calendar", icon: "/brand/icloud-calendar.png" },
  hevy: { name: "Hevy", kind: "Recorded activity", icon: "/brand/hevy.png" },
};
const UNAVAILABLE_ROW: SettingsSectionState = connectorUnavailableSectionState(null);

/** Desktop copy when a source needs a linked Cadence account or a broker-enabled build. */
export function connectorUnavailableReason(name: string, reason: "local" | "build" | null): string {
  return reason === "build" ? `${name} is unavailable in this build.` : `Link a Cadence account on this Mac to connect ${name}.`;
}

// Ticket 238. One sparse list of read-only sources. Every source connects,
// refreshes, fails, and disconnects on its own; tracking never depends on them.
// Ticket 301: `rows` shows each source as one closed row with its provider icon,
// name, kind and state; the source panel reports the state and opens on action.
export function ConnectorLibrary({ sources, rows = false }: Readonly<{ sources: readonly ConnectorLibrarySource[]; rows?: boolean }>) {
  const ordered = SOURCE_ORDER.flatMap((id) => sources.filter((source) => source.id === id));
  const unavailable = (source: ConnectorLibrarySource) =>
    <ConnectorUnavailable id={source.id} reason={source.unavailableReason ?? `${SOURCE_DETAILS[source.id].name} is unavailable in this build.`} />;
  return (
    <SettingsPanel title="Connected sources"
      description="Optional read-only context from other services. Sources never change Behaviors, Occurrences, statuses, Notes, or tracked time. Each source connects and fails separately.">
      {rows ? <div className="grid min-w-0 divide-y divide-line border-t border-line">
        {ordered.map((source) => {
          const details = SOURCE_DETAILS[source.id];
          return <SettingsRow key={source.id} title={details.name} kind={details.kind} icon={<SettingsSourceIcon src={details.icon} />}
            state={source.content ? undefined : UNAVAILABLE_ROW}>{source.content ?? unavailable(source)}</SettingsRow>;
        })}
      </div> : <ul className="grid min-w-0 divide-y divide-line border-t border-line">
        {ordered.map((source) => <li key={source.id} className="min-w-0 pt-4 last:pb-0">
          {source.content ?? unavailable(source)}
        </li>)}
      </ul>}
    </SettingsPanel>
  );
}

/**
 * A source that cannot connect here. Inside a row it reports `state` (Ticket 302:
 * "Link a Cadence account" on a local Mac), so the row never stays at "Checking…".
 */
export function ConnectorUnavailable({ id, reason, state = UNAVAILABLE_ROW }: Readonly<{
  id: ConnectorLibrarySourceId; reason: string; state?: SettingsSectionState }>) {
  const details = SOURCE_DETAILS[id];
  return (
    <SettingsPanel id={`connector-${id}`} headingLevel={3} title={details.name} description={`${details.kind}.`}>
      <SettingsSectionReport state={state} />
      <p className="max-w-2xl text-sm leading-6 text-muted-readable">{reason}</p>
    </SettingsPanel>
  );
}
