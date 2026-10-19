import type { ConnectorProvider } from "@/lib/types/connectors";
import { connectorErrorCode } from "@/lib/ui/connectors";
import type { ConnectorCacheOperations } from "./connector-cache";
import type { CalendarRefreshTrigger } from "./coordinator";

// Ticket 225: one coordinator per connector source on desktop. Each instance
// owns its own epoch, so disconnect, sign-out, account switch, or a scope change
// for one source fences that source's late responses without touching others.

export type ConnectorSnapshotLike = Readonly<{ completeness: "complete" | "incomplete"; fetchedAt: string; failures: ReadonlyArray<Readonly<{ code: string }>> }>;

export type ConnectorSourceResult<T> = Readonly<{
  snapshot: T | null;
  source: "network" | "cache" | "none";
  stale: boolean;
  refreshError: string | null;
}>;

export type ConnectorSourceRules<T extends ConnectorSnapshotLike> = Readonly<{
  provider: ConnectorProvider;
  /** Validates a value and proves it belongs to `scopeKey`; throws otherwise. */
  validate(value: unknown, scopeKey: string): T;
  /** Chooses what to show after a validated refresh. Null means the response is late for this scope. */
  merge(cached: T | null, next: T, scopeKey: string): T | null;
}>;

const REFRESH_INTERVAL_MS = 15 * 60_000;

export class DesktopConnectorSnapshots<T extends ConnectorSnapshotLike> {
  private epoch = 0;
  private readonly failures = new Map<string, string | null>();
  private readonly running = new Map<string, Promise<ConnectorSourceResult<T>>>();

  constructor(private readonly rules: ConnectorSourceRules<T>, private readonly cache: ConnectorCacheOperations) {}

  get provider(): ConnectorProvider { return this.rules.provider; }

  /** Offline bootstrap: the saved snapshot for this account, if it still validates and `accept` agrees. */
  async readCurrent(accountId: string, accept: (scopeKey: string) => boolean): Promise<T | null> {
    const epoch = this.epoch;
    const stored = await this.cache.readCurrent(this.rules.provider, accountId);
    if (!stored || epoch !== this.epoch || !accept(stored.scopeKey)) return null;
    try {
      const snapshot = this.rules.validate(JSON.parse(stored.snapshotJson), stored.scopeKey);
      const key = JSON.stringify([accountId, stored.scopeKey]);
      if (!this.failures.has(key)) this.failures.set(key, null);
      return snapshot;
    }
    catch { await this.cache.clear(this.rules.provider); return null; }
  }

  refresh(accountId: string, scopeKey: string, load: () => Promise<unknown>, trigger: CalendarRefreshTrigger, now = Date.now()): Promise<ConnectorSourceResult<T>> {
    const key = JSON.stringify([accountId, scopeKey]);
    const existing = this.running.get(key);
    if (existing) return existing;
    const epoch = this.epoch;
    const refresh = this.run(accountId, scopeKey, load, trigger, now, epoch).finally(() => { if (this.running.get(key) === refresh) this.running.delete(key); });
    this.running.set(key, refresh);
    return refresh;
  }

  recordFailure(accountId: string, code: string): void {
    for (const key of this.failures.keys()) {
      if (JSON.parse(key)[0] === accountId) this.failures.set(key, code);
    }
  }

  /** Deletes this source's cache and fences every in-flight response for it. */
  clear(): Promise<void> {
    this.epoch += 1;
    this.running.clear();
    this.failures.clear();
    return this.cache.clear(this.rules.provider);
  }

  private async read(accountId: string, scopeKey: string): Promise<T | null> {
    const json = await this.cache.read(this.rules.provider, accountId, scopeKey);
    if (!json) return null;
    try { return this.rules.validate(JSON.parse(json), scopeKey); }
    catch { await this.cache.clear(this.rules.provider); return null; }
  }

  private async run(accountId: string, scopeKey: string, load: () => Promise<unknown>, trigger: CalendarRefreshTrigger, now: number, epoch: number): Promise<ConnectorSourceResult<T>> {
    const key = JSON.stringify([accountId, scopeKey]);
    let cached: T | null = null;
    try {
      cached = await this.read(accountId, scopeKey);
      if (epoch !== this.epoch) return cleared();
      if (cached && !this.failures.has(key)) this.failures.set(key, null);
      if (cached && !shouldRefreshConnector(cached, trigger, now)) return { snapshot: cached, source: "cache", stale: Boolean(this.failures.get(key)), refreshError: this.failures.get(key) ?? null };
      const requestId = crypto.randomUUID();
      await this.cache.begin(this.rules.provider, accountId, scopeKey, requestId);
      const value = await load();
      if (epoch !== this.epoch) return cleared();
      const next = this.rules.validate(value, scopeKey);
      const shown = this.rules.merge(cached, next, scopeKey);
      if (!shown) return cleared();
      if (next.completeness === "complete" && shown === next) {
        await this.cache.replace(this.rules.provider, accountId, scopeKey, requestId, JSON.stringify(next));
        if (epoch !== this.epoch) return cleared();
      }
      const incomplete = next.completeness !== "complete";
      if (incomplete) this.failures.set(key, next.failures[0]?.code ?? "incomplete_pagination");
      else this.failures.set(key, null);
      return { snapshot: shown, source: shown === next ? "network" : "cache", stale: incomplete && shown !== next,
        refreshError: incomplete ? next.failures[0]?.code ?? "incomplete_pagination" : null };
    } catch (error) {
      if (epoch !== this.epoch) return cleared();
      this.failures.set(key, connectorErrorCode(error));
      return { snapshot: cached, source: cached ? "cache" : "none", stale: true, refreshError: connectorErrorCode(error) };
    }
  }
}

function cleared<T>(): ConnectorSourceResult<T> {
  return { snapshot: null, source: "none", stale: true, refreshError: "cleared" };
}

export function shouldRefreshConnector(snapshot: ConnectorSnapshotLike | null, trigger: CalendarRefreshTrigger, now: number): boolean {
  if (trigger === "manual" || trigger === "open" || !snapshot || snapshot.completeness !== "complete") return true;
  const fetched = Date.parse(snapshot.fetchedAt);
  return !Number.isFinite(fetched) || now - fetched >= REFRESH_INTERVAL_MS || now < fetched;
}
