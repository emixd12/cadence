"use client";
import { ConsentForm } from "@/components/oauth/ConsentForm";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import type { OAuthFormAction } from "@/lib/types/oauth-ui";

const action: OAuthFormAction = async () => ({ status: "error", message: "Preview only. No account access changed." });
export function ConsentBench() {
  return <ConsentForm action={action} consent={{ requestId: "preview", accountId: "preview", email: "reader@example.test", clientName: "Example AI client", logoUri: null, verified: false, redirectHost: "client.example", scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"], offlineAccess: true }} />;
}
export function ConnectedAppsBench() {
  return <ConnectedAppsPanel action={action} timezone="America/New_York" view={{ error: null, grants: [{ grantId: "preview", clientId: "preview", clientName: "Example AI client", clientUri: null, logoUri: null, verifiedClient: null, scopes: ["cadence.read"], createdAt: "2026-10-18T12:00:00Z", lastUsedAt: null }], activity: [{ activityId: 1, grantId: "preview", clientName: "Example AI client", operation: "get_timeline", outcome: "success", errorCode: null, occurredAt: "2026-10-18T12:00:00Z" }] }} />;
}
