import type { ReactNode } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import type { ConnectorProvider } from "@/lib/types/connectors";

export type ConnectorLibrarySourceId = "google_calendar" | ConnectorProvider;

/** One source row. Omit `content` when the source cannot be connected here. */
export type ConnectorLibrarySource = Readonly<{
  id: ConnectorLibrarySourceId;
  content?: ReactNode;
  unavailableReason?: string;
}>;

const SOURCE_ORDER: readonly ConnectorLibrarySourceId[] = ["google_calendar", "outlook_calendar", "icloud_calendar", "hevy"];
const SOURCE_DETAILS: Readonly<Record<ConnectorLibrarySourceId, Readonly<{ name: string; kind: string }>>> = {
  google_calendar: { name: "Google Calendar", kind: "Calendar" },
  outlook_calendar: { name: "Outlook Calendar", kind: "Calendar" },
  icloud_calendar: { name: "iCloud Calendar", kind: "Calendar" },
  hevy: { name: "Hevy", kind: "Recorded activity" },
};

/**
 * Ticket 227 integration point: iCloud Calendar stays listed with this truthful
 * availability until its hosted connector ships; then pass its panel as content.
 */
export const ICLOUD_CALENDAR_UNAVAILABLE = "Not available yet. Cadence cannot connect iCloud Calendar in this version.";

/** Desktop copy when a source needs a linked Cadence account or a broker-enabled build. */
export function connectorUnavailableReason(name: string, reason: "local" | "build" | null): string {
  return reason === "build" ? `${name} is unavailable in this build.` : `Link a Cadence account on this Mac to connect ${name}.`;
}

// Ticket 225. One sparse list of read-only sources. Every source connects,
// refreshes, fails, and disconnects on its own; tracking never depends on them.
export function ConnectorLibrary({ sources }: Readonly<{ sources: readonly ConnectorLibrarySource[] }>) {
  const ordered = SOURCE_ORDER.flatMap((id) => sources.filter((source) => source.id === id));
  return (
    <SettingsPanel title="Connected sources"
      description="Optional read-only context from other services. Sources never change Behaviors, Occurrences, statuses, Notes, or tracked time. Each source connects and fails separately.">
      <ul className="grid min-w-0 divide-y divide-line border-t border-line">
        {ordered.map((source) => <li key={source.id} className="min-w-0 pt-4 last:pb-0">
          {source.content ?? <ConnectorUnavailable id={source.id} reason={source.unavailableReason ?? ICLOUD_CALENDAR_UNAVAILABLE} />}
        </li>)}
      </ul>
    </SettingsPanel>
  );
}

export function ConnectorUnavailable({ id, reason }: Readonly<{ id: ConnectorLibrarySourceId; reason: string }>) {
  const details = SOURCE_DETAILS[id];
  return (
    <SettingsPanel id={`connector-${id}`} headingLevel={3} title={details.name} description={`${details.kind}.`}>
      <p className="max-w-2xl text-sm leading-6 text-muted-readable">{reason}</p>
    </SettingsPanel>
  );
}
