import { externalEventSnapshotScopeKey } from "@cadence/core/services/external-event-validation";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { ConnectorConnectionView, ConnectorPreferences } from "@/lib/types/connectors";
import { calendarEventScope, validateCalendarSnapshotForScope, ConnectorClientError, type ConnectorEventRange, type IcloudCalendarCoordinator } from "@/lib/ui/connectors";
import { scopeFromKey } from "./outlook-calendar";
import type { DesktopConnectorBroker } from "./connector-broker";
import type { ConnectorSourceRules, DesktopConnectorSnapshots } from "./connector-coordinator";

export function icloudScopeKey(connection: ConnectorConnectionView, range: ConnectorEventRange): string {
  return JSON.stringify([...JSON.parse(externalEventSnapshotScopeKey(calendarEventScope("icloud_calendar", connection, range))),
    [...connection.preferences.hiddenSourceIds].sort(), connection.preferences.showAllDay, connection.selectionRevision]);
}

/** Display choices travel with the disposable cache scope, outside tracking data and backups. */
export function icloudCacheScopeFromKey(key: string) {
  const parts: unknown = JSON.parse(key);
  if (!Array.isArray(parts) || parts.length !== 10 || !Array.isArray(parts[7]) || parts[7].some(id => typeof id !== "string")
    || typeof parts[8] !== "boolean" || !Number.isSafeInteger(parts[9]) || parts[9] < 0) throw new ConnectorClientError("connection_changed");
  const scope = scopeFromKey(JSON.stringify(parts.slice(0, 7)), "icloud_calendar");
  if (parts[7].some(id => !scope.selectedCalendarIds.includes(id))) throw new ConnectorClientError("connection_changed");
  return { scope, hiddenCalendarIds: parts[7] as string[], showAllDay: parts[8], selectionRevision: parts[9] as number };
}

export function icloudSourceRules(): ConnectorSourceRules<ExternalEventSnapshotV1_1> {
  return { provider: "icloud_calendar",
    validate: (value, key) => validateCalendarSnapshotForScope(value, icloudCacheScopeFromKey(key).scope),
    merge: (cached, next) => next.completeness === "complete" ? next : cached ?? next };
}

/** Sends login values once to the hosted broker; only normalized snapshots enter the disposable cache. */
export class DesktopIcloudCalendarCoordinator implements IcloudCalendarCoordinator {
  constructor(private readonly broker: DesktopConnectorBroker,
    private readonly snapshots: DesktopConnectorSnapshots<ExternalEventSnapshotV1_1>, private readonly changed: () => void) {}

  getConnection() { return this.broker.icloudConnection(); }
  listCalendars() { return this.broker.icloudCalendars(); }
  async connect(appleId: string, appPassword: string) {
    const view = await this.broker.icloudConnect(appleId, appPassword);
    await this.snapshots.clear();
    this.changed();
    return view;
  }
  async savePreferences(preferences: ConnectorPreferences) {
    const view = await this.broker.icloudSavePreferences(preferences);
    await this.snapshots.clear();
    this.changed();
    return view;
  }
  async refreshEvents(range: ConnectorEventRange) {
    const view = await this.getConnection();
    if (view.status !== "connected") throw new ConnectorClientError(view.status);
    const result = await this.snapshots.refresh(view.accountId, icloudScopeKey(view, range), () => this.broker.icloudEvents(range), "manual");
    if (!result.snapshot || (result.refreshError && result.source === "cache")) throw new ConnectorClientError(result.refreshError ?? "provider_unavailable");
    this.changed();
    return result.snapshot;
  }
  async disconnect() {
    await this.snapshots.clear();
    this.changed();
    const result = await this.broker.icloudDisconnect();
    this.changed();
    return result;
  }
}
