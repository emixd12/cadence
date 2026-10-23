import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { AppSupabaseClient } from "./behaviors.repo";
import {
  CONNECTOR_PROVIDERS,
  ConnectorError,
  DEFAULT_CONNECTOR_PREFERENCES,
  type ConnectorConnection,
  type ConnectorOAuthAttempt,
  type ConnectorPreferences,
  type ConnectorProvider,
} from "@/lib/types/connectors";

// Owner metadata and selection use the caller's JWT and RLS. The only privileged
// operations are the exact private-credential RPCs below. Every RPC takes the
// owner ID from an authenticated caller or a consumed one-use attempt, never from
// request input. Database errors are mapped to codes and never forwarded.
const CONNECTION_COLUMNS = "user_id,provider,account_digest,generation,status";
const PREFERENCE_COLUMNS = "user_id,provider,selection_revision,selected_source_ids,hidden_source_ids,visible,show_all_day";

type ConnectionRow = { user_id: string; provider: string; account_digest: string | null; generation: number; status: string };
type PreferenceRow = { provider: string; selection_revision: number; selected_source_ids: string[]; hidden_source_ids: string[]; visible: boolean; show_all_day: boolean };

function toConnection(row: ConnectionRow, preferences: PreferenceRow | undefined): ConnectorConnection {
  if (!(CONNECTOR_PROVIDERS as readonly string[]).includes(row.provider) || !["connected", "disconnected", "reconnect_required"].includes(row.status)) {
    throw new ConnectorError("provider_unavailable");
  }
  return {
    userId: row.user_id,
    provider: row.provider as ConnectorProvider,
    accountDigest: row.account_digest,
    generation: row.generation,
    status: row.status as ConnectorConnection["status"],
    selectionRevision: preferences?.selection_revision ?? 0,
    preferences: preferences
      ? { selectedSourceIds: preferences.selected_source_ids, hiddenSourceIds: preferences.hidden_source_ids, visible: preferences.visible, showAllDay: preferences.show_all_day }
      : DEFAULT_CONNECTOR_PREFERENCES,
  };
}

export async function readConnectorConnections(client: AppSupabaseClient, userId: string): Promise<ConnectorConnection[]> {
  const [connections, preferences] = await Promise.all([
    client.from("connector_connections").select(CONNECTION_COLUMNS).eq("user_id", userId),
    client.from("connector_preferences").select(PREFERENCE_COLUMNS).eq("user_id", userId),
  ]);
  if (connections.error || preferences.error) throw new ConnectorError("provider_unavailable");
  return (connections.data ?? []).map((row) => toConnection(row, preferences.data?.find((entry) => entry.provider === row.provider)));
}

export async function readConnectorConnection(client: AppSupabaseClient, userId: string, provider: ConnectorProvider): Promise<ConnectorConnection | null> {
  const [connection, preferences] = await Promise.all([
    client.from("connector_connections").select(CONNECTION_COLUMNS).eq("user_id", userId).eq("provider", provider).maybeSingle(),
    client.from("connector_preferences").select(PREFERENCE_COLUMNS).eq("user_id", userId).eq("provider", provider).maybeSingle(),
  ]);
  if (connection.error || preferences.error) throw new ConnectorError("provider_unavailable");
  return connection.data ? toConnection(connection.data, preferences.data ?? undefined) : null;
}

/** Disconnect and every preference write advance the revision; stale requests cannot restore an older selection. */
export async function saveConnectorPreferences(client: AppSupabaseClient, userId: string, provider: ConnectorProvider,
  preferences: ConnectorPreferences, expectedSelectionRevision: number): Promise<void> {
  const { data, error } = await client.from("connector_preferences").update({ selected_source_ids: preferences.selectedSourceIds,
    hidden_source_ids: preferences.hiddenSourceIds, visible: preferences.visible, show_all_day: preferences.showAllDay })
    .eq("user_id", userId).eq("provider", provider).eq("selection_revision", expectedSelectionRevision).select("user_id").maybeSingle();
  if (error || !data) throw new ConnectorError("connection_changed");
}

function rpcFailure(error: { message?: string } | null): ConnectorError {
  return new ConnectorError(error?.message?.includes("connector_wrong_account") ? "wrong_account" : "connection_changed");
}

export async function beginConnectorAttempt(attempt: Omit<ConnectorOAuthAttempt, "expiresAt">): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("connector_begin_attempt", { owner_id: attempt.userId, provider_key: attempt.provider,
    state_digest: attempt.stateHash, verifier_ciphertext: attempt.sealedVerifier, expected_generation: attempt.generation,
    return_target: attempt.target, client_nonce: attempt.clientState });
  if (error) throw new ConnectorError("connection_changed");
}

export async function consumeConnectorAttempt(provider: "outlook_calendar", stateHash: string): Promise<ConnectorOAuthAttempt | null> {
  const { data, error } = await createServiceRoleClient().rpc("connector_consume_attempt", { provider_key: provider, state_digest: stateHash });
  if (error) throw new ConnectorError("provider_unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.user_id !== "string" || row.provider !== provider || typeof row.generation !== "number" || typeof row.sealed_verifier !== "string" ||
    (row.target !== "web" && row.target !== "desktop") || typeof row.client_state !== "string" || typeof row.expires_at !== "string" ||
    row.state_hash !== stateHash) throw new ConnectorError("expired_attempt");
  return { userId: row.user_id, provider, generation: row.generation, sealedVerifier: row.sealed_verifier, target: row.target,
    clientState: row.client_state, expiresAt: row.expires_at, stateHash };
}

/** Returns the new generation. `stateHash` is required for Outlook and must be null for direct intake. */
export async function installConnectorCredential(input: { userId: string; provider: ConnectorProvider; accountDigest: string;
  expectedGeneration: number; stateHash: string | null; ciphertext: string }): Promise<number> {
  const { data, error } = await createServiceRoleClient().rpc("connector_install_credential", { owner_id: input.userId, provider_key: input.provider,
    provider_account_digest: input.accountDigest, expected_generation: input.expectedGeneration,
    // Generated RPC argument types cannot express SQL null; direct intake sends null.
    expected_state_hash: input.stateHash as string, credential_ciphertext: input.ciphertext });
  if (error || data !== input.expectedGeneration + 1) throw rpcFailure(error);
  return data;
}

export async function readConnectorCredential(connection: ConnectorConnection): Promise<string> {
  if (!connection.accountDigest) throw new ConnectorError("reconnect_required");
  const { data, error } = await createServiceRoleClient().rpc("connector_read_credential", { owner_id: connection.userId,
    provider_key: connection.provider, expected_account_digest: connection.accountDigest, expected_generation: connection.generation });
  if (error) throw new ConnectorError("provider_unavailable");
  if (typeof data !== "string" || !data) throw new ConnectorError("reconnect_required");
  return data;
}

export async function replaceConnectorCredential(connection: ConnectorConnection, ciphertext: string): Promise<void> {
  if (!connection.accountDigest) throw new ConnectorError("connection_changed");
  const { data, error } = await createServiceRoleClient().rpc("connector_replace_credential", { owner_id: connection.userId,
    provider_key: connection.provider, expected_account_digest: connection.accountDigest, expected_generation: connection.generation,
    credential_ciphertext: ciphertext });
  if (error || data !== true) throw new ConnectorError("connection_changed");
}

/** Fences the selected provider only and returns its new generation. */
export async function disconnectConnectorConnection(connection: ConnectorConnection, status: "disconnected" | "reconnect_required"): Promise<number> {
  const { data, error } = await createServiceRoleClient().rpc("connector_disconnect", { owner_id: connection.userId,
    provider_key: connection.provider, expected_generation: connection.generation, next_status: status });
  if (error || typeof data !== "number") throw new ConnectorError("connection_changed");
  return data;
}
