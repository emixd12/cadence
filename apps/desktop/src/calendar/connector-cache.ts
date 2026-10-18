import { invoke } from "@tauri-apps/api/core";
import type { ConnectorProvider } from "@/lib/types/connectors";

// Ticket 225: thin transport for the per-source native cache in
// calendar-cache.sqlite3 (outside cadence.sqlite3 and user backups). It stores
// only validated, complete snapshots keyed by the scope key and never a credential.

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type ConnectorCacheOperations = Readonly<{
  read(provider: ConnectorProvider, accountId: string, scopeKey: string): Promise<string | null>;
  readCurrent(provider: ConnectorProvider, accountId: string): Promise<Readonly<{ scopeKey: string; snapshotJson: string }> | null>;
  begin(provider: ConnectorProvider, accountId: string, scopeKey: string, requestId: string): Promise<void>;
  replace(provider: ConnectorProvider, accountId: string, scopeKey: string, requestId: string, snapshotJson: string): Promise<void>;
  clear(provider?: ConnectorProvider): Promise<void>;
}>;

export class DesktopConnectorCache implements ConnectorCacheOperations {
  constructor(private readonly call: Invoke = invoke) {}

  read(provider: ConnectorProvider, accountId: string, scopeKey: string): Promise<string | null> {
    return this.call("connector_cache_read", { provider, accountId, scopeKey });
  }
  readCurrent(provider: ConnectorProvider, accountId: string): Promise<{ scopeKey: string; snapshotJson: string } | null> {
    return this.call("connector_cache_read_current", { provider, accountId });
  }
  begin(provider: ConnectorProvider, accountId: string, scopeKey: string, requestId: string): Promise<void> {
    return this.call("connector_cache_begin", { provider, accountId, scopeKey, requestId });
  }
  replace(provider: ConnectorProvider, accountId: string, scopeKey: string, requestId: string, snapshotJson: string): Promise<void> {
    return this.call("connector_cache_replace", { provider, accountId, scopeKey, requestId, snapshotJson });
  }
  clear(provider?: ConnectorProvider): Promise<void> {
    return this.call("connector_cache_clear", { provider: provider ?? null });
  }
}
