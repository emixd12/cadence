import type { ExternalEventErrorCode } from "@cadence/core/types/external-event";

// Ticket 222 lifecycle types for the new hosted connectors. Google Calendar keeps
// its own types in `lib/types/google-calendar.ts`.
export const CONNECTOR_PROVIDERS = ["hevy", "outlook_calendar", "icloud_calendar"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
export type ConnectorStatus = "connected" | "disconnected" | "reconnect_required";

export type ConnectorPreferences = Readonly<{
  selectedSourceIds: string[];
  hiddenSourceIds: string[];
  visible: boolean;
  showAllDay: boolean;
}>;
export const DEFAULT_CONNECTOR_PREFERENCES: ConnectorPreferences = Object.freeze({
  selectedSourceIds: [],
  hiddenSourceIds: [],
  visible: true,
  showAllDay: true,
});

/** Server-side owner metadata read through the caller's JWT and RLS. */
export type ConnectorConnection = Readonly<{
  userId: string;
  provider: ConnectorProvider;
  /** SHA-256 of the provider-namespaced account identity; null when disconnected. */
  accountDigest: string | null;
  generation: number;
  status: ConnectorStatus;
  selectionRevision: number;
  preferences: ConnectorPreferences;
}>;

/** Client-safe connection state. It never carries a credential or account digest. */
export type ConnectorConnectionView = Readonly<{
  accountId: string;
  provider: ConnectorProvider;
  status: ConnectorStatus | "not_configured";
  generation: number;
  selectionRevision: number;
  preferences: ConnectorPreferences;
}>;

/** Provider-specific removal step after disconnect or account deletion. No provider offers app-side revocation. */
export type ConnectorRevocationInstruction = "hevy_api_key" | "microsoft_account_permissions" | "apple_app_specific_password";
export const CONNECTOR_REVOCATION_INSTRUCTIONS: Readonly<Record<ConnectorProvider, ConnectorRevocationInstruction>> = Object.freeze({
  hevy: "hevy_api_key",
  outlook_calendar: "microsoft_account_permissions",
  icloud_calendar: "apple_app_specific_password",
});

/** Plaintext secret shapes. These exist only inside server request scope. */
export type ConnectorCredential =
  | Readonly<{ provider: "hevy"; apiKey: string }>
  | Readonly<{ provider: "outlook_calendar"; refreshToken: string }>
  | Readonly<{ provider: "icloud_calendar"; appleId: string; appPassword: string }>;

export type ConnectorOAuthAttempt = Readonly<{
  userId: string;
  provider: "outlook_calendar";
  generation: number;
  stateHash: string;
  sealedVerifier: string;
  target: "web" | "desktop";
  clientState: string;
  expiresAt: string;
}>;

export type ConnectorErrorCode =
  | ExternalEventErrorCode
  | "not_configured"
  | "connection_changed"
  | "expired_attempt"
  | "consent_denied";

/** Carries only a stable code. Never attach provider bodies, credentials, or causes. */
export class ConnectorError extends Error {
  constructor(public readonly code: ConnectorErrorCode) {
    super(code);
    this.name = "ConnectorError";
  }
}
