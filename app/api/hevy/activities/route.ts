import { connectorPreflight, runConnectorRequest } from "@/lib/services/connector-request";
import { getPersistedHevySnapshotV1 } from "@/lib/services/recorded-activity-sync.service";

// Tickets 236 & 353: read-only recorded workout timing for inclusive local dates
// from persisted `recorded_activities` after 15-minute freshness check.
export const OPTIONS = connectorPreflight;
export function GET(request: Request) {
  const url = new URL(request.url);
  return runConnectorRequest(request, (caller) =>
    getPersistedHevySnapshotV1(caller, url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "", "timeline"));
}
