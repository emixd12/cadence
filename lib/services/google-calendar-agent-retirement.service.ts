import { createServiceRoleClient } from "@/lib/supabase/admin";
import { readCalendarCredential, removeCalendarCredential } from "@/lib/db/google-calendar.repo";
import { DEFAULT_CALENDAR_PREFERENCES, type CalendarConnection } from "@/lib/types/google-calendar";
import { openCalendarSecret, readCalendarOAuthConfig, revokeCalendarToken } from "./google-calendar-oauth";

/**
 * Ticket 307: one-off retirement of the separate Daily Brief Google Calendar grants
 * (Ticket 187). Run before migration 20261110160000, which deletes their tables.
 *
 * Each connected grant is revoked at Google first and only then disconnected, so a
 * revocation that fails at Google keeps its credential for the next run. Revoked
 * grants are no longer connected, so a rerun skips them. A credential that cannot
 * be opened (another agent client or sealing key) cannot be revoked by Cadence; it is
 * removed and counted as unrevocable. A grant whose credential the read RPC cannot
 * return (its Google identity is gone) is disconnected first and its token revoked
 * once. The report holds counts only: never tokens, user IDs or subjects.
 */
export type AgentCalendarRetirementReport = Readonly<{
  state: "complete" | "incomplete" | "not_configured";
  revoked: number;
  /** Removed without revocation at Google: Cadence could not open the token. */
  unrevocable: number;
  /** Google did not confirm revocation; the credential stays for the next run. */
  failed: number;
  /** Connected grants left after this run, including ones beyond the batch limit. */
  remaining: number;
}>;

export const AGENT_CALENDAR_RETIREMENT_BATCH = 100;

type AgentGrantRow = Readonly<{ user_id: string; google_subject: string; generation: number; oauth_client_id: string | null }>;

export type AgentCalendarRetirementDependencies = Readonly<{
  env?: Record<string, string | undefined>;
  listConnected?: (limit: number) => Promise<{ rows: readonly AgentGrantRow[]; total: number }>;
  readCredential?: (connection: CalendarConnection) => Promise<string>;
  removeCredential?: (connection: CalendarConnection) => Promise<string | null>;
  revoke?: (token: string) => Promise<void>;
}>;

export async function retireDailyBriefCalendarGrants(dependencies: AgentCalendarRetirementDependencies = {}): Promise<AgentCalendarRetirementReport> {
  const listConnected = dependencies.listConnected ?? listConnectedAgentGrants;
  const readCredential = dependencies.readCredential ?? readCalendarCredential;
  const removeCredential = dependencies.removeCredential ?? ((connection: CalendarConnection) => removeCalendarCredential(connection, "disconnected"));
  const revoke = dependencies.revoke ?? ((token: string) => revokeCalendarToken(token));

  const listed = await listConnected(AGENT_CALENDAR_RETIREMENT_BATCH);
  const settings = readCalendarOAuthConfig(dependencies.env ?? process.env, undefined, "agent");
  // Without the agent client and sealing key no credential can be opened or revoked.
  if (!settings) return { state: listed.total ? "not_configured" : "complete", revoked: 0, unrevocable: 0, failed: 0, remaining: listed.total };

  let revoked = 0;
  let unrevocable = 0;
  let failed = 0;
  for (const row of listed.rows) {
    const connection: CalendarConnection = {
      grantPurpose: "agent", oauthClientId: row.oauth_client_id ?? undefined, userId: row.user_id, googleSubject: row.google_subject,
      generation: row.generation, selectionRevision: 0, status: "connected", preferences: DEFAULT_CALENDAR_PREFERENCES,
    };
    const open = (sealed: string): string | null => {
      try { return openCalendarSecret(settings, sealed, { purpose: "refresh", userId: row.user_id, googleSubject: row.google_subject, generation: row.generation }); }
      catch { return null; }
    };
    try {
      const sealed = await readCredential(connection).catch(() => null);
      const removedFirst = sealed ? null : await removeCredential(connection);
      const token = open(sealed ?? removedFirst ?? "");
      if (!token) {
        if (sealed) await removeCredential(connection);
        unrevocable += 1;
        continue;
      }
      try { await revoke(token); }
      catch {
        if (removedFirst) unrevocable += 1; else failed += 1;
        continue;
      }
      if (sealed) await removeCredential(connection);
      revoked += 1;
    } catch {
      failed += 1;
    }
  }
  const remaining = (await listConnected(0)).total;
  return { state: remaining === 0 ? "complete" : "incomplete", revoked, unrevocable, failed, remaining };
}

/** Service-role read of connected Daily Brief grants. After the migration the table is empty. */
async function listConnectedAgentGrants(limit: number): Promise<{ rows: readonly AgentGrantRow[]; total: number }> {
  const { data, error, count } = await createServiceRoleClient().from("google_calendar_agent_connections")
    .select("user_id, google_subject, generation, oauth_client_id", { count: "exact" })
    .eq("status", "connected").order("user_id", { ascending: true }).limit(Math.max(limit, 1));
  if (error) throw new Error("Daily Brief Calendar grants could not be listed.");
  return { rows: limit > 0 ? (data ?? []) as AgentGrantRow[] : [], total: count ?? 0 };
}
