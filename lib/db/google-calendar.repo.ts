import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { AppSupabaseClient } from "./behaviors.repo";
import type { CalendarConnection, CalendarOAuthAttempt, CalendarPreferences, CalendarPurpose } from "@/lib/types/google-calendar";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/lib/types/google-calendar";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";

// The only privileged Calendar operations are these exact private-credential RPCs.
// Ordinary settings reads and updates retain the caller's JWT and RLS.
export async function readCalendarConnection(client: AppSupabaseClient, userId: string, grantPurpose: CalendarPurpose = "standard"): Promise<CalendarConnection | null> {
  const [{ data, error }, preferences] = await Promise.all([
    client.from(grantPurpose === "agent" ? "google_calendar_agent_connections" : "google_calendar_connections").select("*").eq("user_id", userId).maybeSingle(),
    client.from(grantPurpose === "agent" ? "google_calendar_agent_preferences" : "google_calendar_preferences").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (error || preferences.error) throw new CalendarConnectionError("provider_unavailable");
  if (!data) return null;
  return { ...(grantPurpose === "agent" ? { grantPurpose, oauthClientId: "oauth_client_id" in data && typeof data.oauth_client_id === "string" ? data.oauth_client_id : undefined } : {}), userId: data.user_id, googleSubject: data.google_subject, generation: data.generation,
    status: data.status as CalendarConnection["status"], selectionRevision: preferences.data?.selection_revision ?? 0,
    preferences: preferences.data ? { selectedCalendarIds: preferences.data.selected_calendar_ids, hiddenCalendarIds: preferences.data.hidden_calendar_ids,
      visible: preferences.data.visible, showAllDay: preferences.data.show_all_day } : DEFAULT_CALENDAR_PREFERENCES };
}
export async function saveCalendarPreferences(client: AppSupabaseClient, userId: string, preferences: CalendarPreferences, grantPurpose: CalendarPurpose = "standard"): Promise<void> {
  const { data, error } = await client.from(grantPurpose === "agent" ? "google_calendar_agent_preferences" : "google_calendar_preferences").update({ selected_calendar_ids: preferences.selectedCalendarIds,
    hidden_calendar_ids: preferences.hiddenCalendarIds, visible: preferences.visible, show_all_day: preferences.showAllDay }).eq("user_id", userId).select("user_id").maybeSingle();
  if (error || !data) throw new CalendarConnectionError("connection_changed");
}
export async function beginCalendarAttempt(attempt: Omit<CalendarOAuthAttempt, "expiresAt">): Promise<void> {
  const { error } = await createServiceRoleClient().rpc(attempt.grantPurpose === "agent" ? "calendar_agent_begin_attempt" : "calendar_begin_attempt", { owner_id: attempt.userId, expected_subject: attempt.googleSubject,
    state_digest: attempt.stateHash, verifier_ciphertext: attempt.sealedVerifier, expected_generation: attempt.generation,
    return_target: attempt.target, client_nonce: attempt.clientState, ...(attempt.grantPurpose === "agent" ? { expected_client_id: attempt.oauthClientId! } : {}) });
  if (error) throw new CalendarConnectionError("connection_changed");
}
export async function consumeCalendarAttempt(stateHash: string, grantPurpose: CalendarPurpose = "standard"): Promise<CalendarOAuthAttempt | null> {
  const { data, error } = await createServiceRoleClient().rpc(grantPurpose === "agent" ? "calendar_agent_consume_attempt" : "calendar_consume_attempt", { state_digest: stateHash });
  if (error) throw new CalendarConnectionError("provider_unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.user_id !== "string" || typeof row.google_subject !== "string" || typeof row.generation !== "number" || typeof row.sealed_verifier !== "string" ||
    (row.target !== "web" && row.target !== "desktop") || typeof row.client_state !== "string" || typeof row.expires_at !== "string") throw new CalendarConnectionError("expired_attempt");
  if (grantPurpose === "agent" && typeof row.oauth_client_id !== "string") throw new CalendarConnectionError("expired_attempt");
  return { ...(grantPurpose === "agent" ? { grantPurpose, oauthClientId: row.oauth_client_id as string } : {}), userId: row.user_id, googleSubject: row.google_subject, generation: row.generation, sealedVerifier: row.sealed_verifier,
    target: row.target, clientState: row.client_state, expiresAt: row.expires_at, stateHash };
}
export async function installCalendarCredential(attempt: CalendarOAuthAttempt, ciphertext: string): Promise<void> {
  const { data, error } = await createServiceRoleClient().rpc(attempt.grantPurpose === "agent" ? "calendar_agent_install_credential" : "calendar_install_credential", { owner_id: attempt.userId, expected_subject: attempt.googleSubject,
    expected_generation: attempt.generation, expected_state_hash: attempt.stateHash, token_ciphertext: ciphertext, ...(attempt.grantPurpose === "agent" ? { expected_client_id: attempt.oauthClientId! } : {}) });
  if (error || data !== true) throw new CalendarConnectionError("connection_changed");
}
export async function readCalendarCredential(connection: CalendarConnection): Promise<string> {
  const { data, error } = await createServiceRoleClient().rpc(connection.grantPurpose === "agent" ? "calendar_agent_read_credential" : "calendar_read_credential", { owner_id: connection.userId,
    expected_subject: connection.googleSubject, expected_generation: connection.generation });
  if (error || !data) throw new CalendarConnectionError("reconnect_required");
  return data;
}
export async function removeCalendarCredential(connection: CalendarConnection, status: "disconnected" | "reconnect_required"): Promise<string | null> {
  const { data, error } = await createServiceRoleClient().rpc(connection.grantPurpose === "agent" ? "calendar_agent_disconnect" : "calendar_disconnect", { owner_id: connection.userId,
    expected_subject: connection.googleSubject, expected_generation: connection.generation, next_status: status });
  if (error) throw new CalendarConnectionError("provider_unavailable");
  return data;
}
export async function readCalendarCallbackUser(userId: string) {
  const { data, error } = await createServiceRoleClient().auth.admin.getUserById(userId);
  if (error || !data.user) throw new CalendarConnectionError("unauthenticated");
  return data.user;
}
