import { invoke } from "@tauri-apps/api/core";
import { externalEventSnapshotScopeKey } from "@cadence/core/services/external-event-validation";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { ConnectorConnectionView, ConnectorPreferences } from "@/lib/types/connectors";
import {
  ConnectorClientError,
  outlookEventScope,
  validateOutlookSnapshotForScope,
  type ConnectorEventRange,
  type OutlookCalendarCoordinator,
  type OutlookConnectResult,
} from "@/lib/ui/connectors";
import type { DesktopConnectorBroker } from "./connector-broker";
import { DesktopConnectorSnapshots, type ConnectorSourceRules } from "./connector-coordinator";
import { randomState } from "./google-calendar";

// Ticket 225 desktop Outlook Calendar. Completion goes through the hosted PUT
// with this app's Cadence session and a Keychain-held client state. A callback
// is honored only when its state matches the attempt this app started; the
// attempt is one-use and cleared on success, failure, cancellation, expiry, and
// account change. Codes and states are never logged or persisted outside Keychain.

export const DESKTOP_OUTLOOK_CALLBACK = "cadence://outlook-calendar/callback";
export const OUTLOOK_ATTEMPT_KEY = "pending-outlook-calendar-attempt";
const MAX_ATTEMPT_AGE_MS = 5 * 60_000;
const STATE = /^[A-Za-z0-9_-]{16,256}$/;
const CLIENT_STATE = /^[A-Za-z0-9_-]{32,128}$/;

type PendingOutlookAttempt = Readonly<{ accountId: string; state: string; clientState: string; createdAt: number }>;

export type OutlookAttemptStore = Readonly<{
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  open(url: string): Promise<void>;
}>;

const keychain: OutlookAttemptStore = {
  get: (name) => invoke("auth_secret_get", { name }),
  set: (name, value) => invoke("auth_secret_set", { name, value }),
  remove: (name) => invoke("auth_secret_remove", { name }),
  open: (url) => invoke("auth_open_url", { url }),
};

export function isDesktopOutlookCallback(value: string): boolean {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}` === DESKTOP_OUTLOOK_CALLBACK; }
  catch { return false; }
}

/** The OAuth state the hosted start embedded in its Microsoft authorization URL. */
export function outlookAuthorizationState(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorClientError("invalid_request"); }
  const state = url.searchParams.get("state") ?? "";
  if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com" || url.username || url.password || !STATE.test(state)) {
    throw new ConnectorClientError("invalid_request");
  }
  return state;
}

function parsePending(value: string | null): PendingOutlookAttempt | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingOutlookAttempt>;
    return typeof parsed.accountId === "string" && parsed.accountId && typeof parsed.state === "string" && STATE.test(parsed.state)
      && typeof parsed.clientState === "string" && CLIENT_STATE.test(parsed.clientState) && typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
      ? parsed as PendingOutlookAttempt : null;
  } catch { return null; }
}

export class DesktopOutlookConnection {
  constructor(private readonly broker: Pick<DesktopConnectorBroker, "outlookStart" | "outlookComplete">, private readonly io: OutlookAttemptStore = keychain) {}

  async begin(accountId: string, now = Date.now()): Promise<void> {
    await this.io.remove(OUTLOOK_ATTEMPT_KEY);
    const clientState = randomState();
    const { url } = await this.broker.outlookStart(clientState);
    const state = outlookAuthorizationState(url);
    const pending: PendingOutlookAttempt = { accountId, state, clientState, createdAt: now };
    await this.io.set(OUTLOOK_ATTEMPT_KEY, JSON.stringify(pending));
    try { await this.io.open(url); }
    catch (error) { await this.io.remove(OUTLOOK_ATTEMPT_KEY); throw error; }
  }

  /**
   * Returns null for other links, "ignored" for an Outlook link this app did not
   * start (the pending attempt stays intact), and the hosted result otherwise.
   */
  async complete(value: string, accountId: string, now = Date.now()): Promise<OutlookConnectResult | null> {
    if (!isDesktopOutlookCallback(value)) return null;
    const url = new URL(value);
    const state = url.searchParams.get("state");
    const pending = parsePending(await this.io.get(OUTLOOK_ATTEMPT_KEY));
    if (!pending || !state || state !== pending.state) return "ignored";
    await this.io.remove(OUTLOOK_ATTEMPT_KEY);
    if (pending.accountId !== accountId || now < pending.createdAt || now - pending.createdAt > MAX_ATTEMPT_AGE_MS) return "expired_attempt";
    const code = url.searchParams.get("code");
    const result = url.searchParams.get("result");
    const outcome = code && !result && code.length <= 8192
      ? await this.broker.outlookComplete({ state, clientState: pending.clientState, code })
      : await this.broker.outlookComplete({ state, clientState: pending.clientState,
        result: result === "cancelled" || result === "admin_approval_required" ? result : "error" });
    return outcome.result === "connected" || outcome.result === "cancelled" || outcome.result === "admin_approval_required" ? outcome.result : "error";
  }

  cancel(): Promise<void> { return this.io.remove(OUTLOOK_ATTEMPT_KEY); }
}

export function outlookSourceRules(): ConnectorSourceRules<ExternalEventSnapshotV1_1> {
  return {
    provider: "outlook_calendar",
    validate(value, scopeKey) {
      const snapshot = validateOutlookSnapshotForScope(value, scopeFromKey(scopeKey));
      if (externalEventSnapshotScopeKey(scopeFromKey(scopeKey)) !== scopeKey) throw new ConnectorClientError("connection_changed");
      return snapshot;
    },
    // A complete read replaces; an incomplete read never erases a complete cached read.
    merge: (cached, next) => next.completeness === "complete" ? next : cached ?? next,
  };
}

/** Parses an Outlook scope key back into the scope it names. */
export function scopeFromKey(scopeKey: string) {
  const parsed: unknown = JSON.parse(scopeKey);
  if (!Array.isArray(parsed) || parsed.length !== 7 || parsed[0] !== "outlook_calendar" || typeof parsed[1] !== "string" || typeof parsed[2] !== "number"
    || typeof parsed[3] !== "string" || typeof parsed[4] !== "string" || typeof parsed[5] !== "string" || !Array.isArray(parsed[6])
    || parsed[6].some((id) => typeof id !== "string")) throw new ConnectorClientError("connection_changed");
  return { source: "outlook_calendar" as const, accountId: parsed[1], connectionGeneration: parsed[2], startLocalDate: parsed[3],
    endLocalDate: parsed[4], timezone: parsed[5], selectedCalendarIds: parsed[6] as string[] };
}

export function outlookScopeKey(connection: ConnectorConnectionView, range: ConnectorEventRange): string {
  return externalEventSnapshotScopeKey(outlookEventScope(connection, range));
}

/** Settings coordinator over the hosted broker and the per-source cache. */
export class DesktopOutlookCalendarPanelCoordinator implements OutlookCalendarCoordinator {
  constructor(
    private readonly broker: DesktopConnectorBroker,
    private readonly snapshots: DesktopConnectorSnapshots<ExternalEventSnapshotV1_1>,
    private readonly connection: DesktopOutlookConnection,
    private readonly changed: () => void,
  ) {}

  getConnection(): Promise<ConnectorConnectionView> { return this.broker.outlookConnection(); }
  async beginConnect(): Promise<void> {
    const view = await this.broker.outlookConnection();
    await this.snapshots.clear();
    this.changed();
    await this.connection.begin(view.accountId);
  }
  listCalendars() { return this.broker.outlookCalendars(); }
  async savePreferences(preferences: ConnectorPreferences): Promise<ConnectorConnectionView> {
    const view = await this.broker.outlookSavePreferences(preferences);
    await this.snapshots.clear();
    this.changed();
    return view;
  }
  async refreshEvents(range: ConnectorEventRange): Promise<ExternalEventSnapshotV1_1> {
    const view = await this.broker.outlookConnection();
    if (view.status !== "connected") throw new ConnectorClientError(view.status);
    const scopeKey = outlookScopeKey(view, range);
    const result = await this.snapshots.refresh(view.accountId, scopeKey, () => this.broker.outlookEvents(range), "manual");
    if (!result.snapshot) throw new ConnectorClientError(result.refreshError ?? "provider_unavailable");
    if (result.refreshError && result.snapshot.completeness === "complete" && result.source === "cache") throw new ConnectorClientError(result.refreshError);
    this.changed();
    return result.snapshot;
  }
  async disconnect() {
    await Promise.all([this.snapshots.clear(), this.connection.cancel()]);
    this.changed();
    const result = await this.broker.outlookDisconnect();
    this.changed();
    return result;
  }
}
