import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { ConnectorConnectionView, ConnectorPreferences, ConnectorRevocationInstruction } from "@/lib/types/connectors";
import type { ConnectorCalendarEntry, ConnectorDisconnectResult, ConnectorEventRange } from "@/lib/ui/connectors";
import type { DesktopCalendarBroker } from "./google-calendar";

// Ticket 238: Outlook and Hevy hosted routes over the existing authenticated
// broker transport (HTTPS origin, bearer session, no redirects, timeout). The
// desktop sends entered credentials once and never stores them.

export type OutlookDesktopCompletion = Readonly<{ state: string; clientState: string } & ({ code: string } | { result: "cancelled" | "admin_approval_required" | "error" })>;

export class DesktopConnectorBroker {
  constructor(private readonly transport: Pick<DesktopCalendarBroker, "request">) {}

  outlookConnection(): Promise<ConnectorConnectionView> { return this.transport.request("/api/outlook-calendar/connection"); }
  outlookStart(clientState: string): Promise<{ url: string }> {
    return this.transport.request("/api/outlook-calendar/connection", { method: "POST", body: JSON.stringify({ target: "desktop", clientState }) });
  }
  outlookComplete(body: OutlookDesktopCompletion): Promise<ConnectorConnectionView & { result: string }> {
    return this.transport.request("/api/outlook-calendar/connection", { method: "PUT", body: JSON.stringify(body) });
  }
  async outlookCalendars(): Promise<ConnectorCalendarEntry[]> {
    return (await this.transport.request<{ calendars: ConnectorCalendarEntry[] }>("/api/outlook-calendar/calendars")).calendars;
  }
  outlookSavePreferences(preferences: ConnectorPreferences): Promise<ConnectorConnectionView> {
    return this.transport.request("/api/outlook-calendar/calendars", { method: "PUT", body: JSON.stringify(preferences) });
  }
  outlookEvents(range: ConnectorEventRange): Promise<ExternalEventSnapshotV1_1> {
    return this.transport.request(`/api/outlook-calendar/events?${new URLSearchParams({ start: range.startLocalDate, end: range.endLocalDate })}`);
  }
  outlookDisconnect(): Promise<ConnectorDisconnectResult> { return this.disconnect("/api/outlook-calendar/connection"); }

  icloudConnection(): Promise<ConnectorConnectionView> { return this.transport.request("/api/icloud-calendar/connection"); }
  icloudConnect(appleId: string, appPassword: string): Promise<ConnectorConnectionView> {
    return this.transport.request("/api/icloud-calendar/connection", { method: "POST", body: JSON.stringify({ appleId, appPassword }) });
  }
  async icloudCalendars(): Promise<ConnectorCalendarEntry[]> {
    return (await this.transport.request<{ calendars: ConnectorCalendarEntry[] }>("/api/icloud-calendar/calendars")).calendars;
  }
  icloudSavePreferences(preferences: ConnectorPreferences): Promise<ConnectorConnectionView> {
    return this.transport.request("/api/icloud-calendar/calendars", { method: "PUT", body: JSON.stringify(preferences) });
  }
  icloudEvents(range: ConnectorEventRange): Promise<ExternalEventSnapshotV1_1> {
    return this.transport.request(`/api/icloud-calendar/events?${new URLSearchParams({ start: range.startLocalDate, end: range.endLocalDate })}`);
  }
  icloudDisconnect(): Promise<ConnectorDisconnectResult> { return this.disconnect("/api/icloud-calendar/connection"); }

  hevyConnection(): Promise<ConnectorConnectionView> { return this.transport.request("/api/hevy/connection"); }
  /** Posts the key once over the authenticated broker; nothing is persisted locally. */
  hevyConnect(apiKey: string): Promise<ConnectorConnectionView> {
    return this.transport.request("/api/hevy/connection", { method: "POST", body: JSON.stringify({ apiKey }) });
  }
  hevyActivities(localDate: string): Promise<unknown> {
    return this.transport.request(`/api/hevy/activities?${new URLSearchParams({ start: localDate, end: localDate })}`);
  }
  hevyDisconnect(): Promise<ConnectorDisconnectResult> { return this.disconnect("/api/hevy/connection"); }

  private async disconnect(path: string): Promise<ConnectorDisconnectResult> {
    const result = await this.transport.request<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }>(path, { method: "DELETE" });
    const { revocation, ...view } = result;
    return { view, revocation };
  }
}
