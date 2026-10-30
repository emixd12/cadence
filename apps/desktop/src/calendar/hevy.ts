import { Temporal } from "@js-temporal/polyfill";
import { applyScopedRecordedActivityRefresh, type RecordedActivityRefresh } from "@cadence/core/services/recorded-activity-refresh";
import { recordedActivitySnapshotScopeKey } from "@cadence/core/services/recorded-activity-validation";
import type { RecordedActivitySnapshotScope, RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import { ConnectorClientError, hevyActivityScope, validateHevySnapshot, type HevyCoordinator } from "@/lib/ui/connectors";
import type { DesktopConnectorBroker } from "./connector-broker";
import { DesktopConnectorSnapshots, type ConnectorSourceRules } from "./connector-coordinator";

// Ticket 238 desktop Hevy. The key is posted once to the hosted broker and never
// stored on this Mac. Recorded workouts are cached per account, generation,
// day, and timezone; the cache compares a refresh only with its same-scope entry.

export function hevyScopeFromKey(scopeKey: string): RecordedActivitySnapshotScope {
  const parsed: unknown = JSON.parse(scopeKey);
  if (!Array.isArray(parsed) || parsed.length !== 6 || parsed[0] !== "hevy" || typeof parsed[1] !== "string" || typeof parsed[2] !== "number"
    || typeof parsed[3] !== "string" || typeof parsed[4] !== "string" || typeof parsed[5] !== "string") throw new ConnectorClientError("connection_changed");
  return { source: "hevy", accountId: parsed[1], connectionGeneration: parsed[2], startLocalDate: parsed[3], endLocalDate: parsed[4], timezone: parsed[5] };
}

export function hevySourceRules(now: () => Temporal.Instant = () => Temporal.Now.instant()): ConnectorSourceRules<RecordedActivitySnapshotV1> {
  return {
    provider: "hevy",
    validate(value, scopeKey) {
      const snapshot = validateHevySnapshot(value, now());
      const scope = hevyScopeFromKey(scopeKey);
      if (recordedActivitySnapshotScopeKey(scope) !== scopeKey || !applyScopedRecordedActivityRefresh({ activeScope: scope, cached: null, next: snapshot })) {
        throw new ConnectorClientError("connection_changed");
      }
      return snapshot;
    },
    merge(cached, next, scopeKey) {
      return applyScopedRecordedActivityRefresh({ activeScope: hevyScopeFromKey(scopeKey), cached, next })?.snapshot ?? null;
    },
  };
}

export function hevyScopeKey(connection: ConnectorConnectionView, localDate: string, timezone: string): string {
  return recordedActivitySnapshotScopeKey(hevyActivityScope(connection, localDate, timezone));
}

export class DesktopHevyCoordinator implements HevyCoordinator {
  constructor(
    private readonly broker: DesktopConnectorBroker,
    private readonly snapshots: DesktopConnectorSnapshots<RecordedActivitySnapshotV1>,
    private readonly changed: () => void,
  ) {}

  getConnection(): Promise<ConnectorConnectionView> { return this.broker.hevyConnection(); }
  async connect(apiKey: string): Promise<ConnectorConnectionView> {
    await this.snapshots.clear();
    const view = await this.broker.hevyConnect(apiKey);
    this.changed();
    return view;
  }
  async refreshActivities(localDate: string, timezone: string): Promise<RecordedActivityRefresh> {
    const view = await this.broker.hevyConnection();
    if (view.status !== "connected") throw new ConnectorClientError(view.status);
    const result = await this.snapshots.refresh(view.accountId, hevyScopeKey(view, localDate, timezone), () => this.broker.hevyActivities(localDate), "manual");
    if (!result.snapshot) throw new ConnectorClientError(result.refreshError ?? "provider_unavailable");
    this.changed();
    const failures = result.refreshError ? [{ code: result.refreshError as RecordedActivitySnapshotV1["failures"][number]["code"], retryable: true, retryAfterSeconds: null, message: result.refreshError }] : [];
    return { snapshot: result.snapshot, replaced: result.source === "network", refreshFailures: failures };
  }
  async disconnect() {
    await this.snapshots.clear();
    this.changed();
    const result = await this.broker.hevyDisconnect();
    this.changed();
    return result;
  }
}
