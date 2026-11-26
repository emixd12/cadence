import type { SchedulePairingYes } from "@cadence/core/resolvers/alongside-schedule-pairing.resolver";
import { ALONGSIDE_PAIRING_REASON_CODE } from "@cadence/core/resolvers/alongside-pairing.resolver";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 362 (D33, "Pairing the schedule"): the coach's reads for a pairing proposal, on
// the coach agent's client, as the person, under RLS. Ids and dates only.

export class SchedulePairingReadError extends Error {
  constructor(public readonly code: string) {
    super(`Schedule pairing read failed: ${code}.`);
    this.name = "SchedulePairingReadError";
  }
}

/**
 * The Daily Brief pairing lines the person said Yes to, dated in [since, until]: a
 * `move_proposals` row with source daily_brief, reason alongside_pairing and status
 * accepted (Yes or Accept all, not undone; Other time is not a Yes to the pairing), its
 * guest the row's Behavior and its host `line.pairing.hostBehaviorId` (Ticket 361).
 */
export async function readAcceptedBriefPairings(client: AppSupabaseClient, userId: string,
  input: Readonly<{ since: string; until: string }>): Promise<SchedulePairingYes[]> {
  const { data, error } = await client.from("move_proposals")
    .select("behavior_id,local_date,line")
    .eq("user_id", userId).eq("source", "daily_brief").eq("reason", ALONGSIDE_PAIRING_REASON_CODE).eq("status", "accepted")
    .gte("local_date", input.since).lte("local_date", input.until)
    .order("local_date", { ascending: false }).limit(500);
  if (error) throw new SchedulePairingReadError("read_brief_pairings_failed");
  return (data ?? []).flatMap((row) => {
    const line = row.line as { pairing?: { hostBehaviorId?: unknown } } | null;
    const host = line && typeof line === "object" ? line.pairing?.hostBehaviorId : undefined;
    return typeof host === "string" && host.length > 0
      ? [{ guestBehaviorId: row.behavior_id, hostBehaviorId: host, localDate: row.local_date }] : [];
  });
}

/** Behaviors switched to "Don't suggest moving this". */
export async function readNeverMoveBehaviorIds(client: AppSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await client.from("behavior_move_preferences").select("behavior_id,never_suggest_move").eq("user_id", userId);
  if (error) throw new SchedulePairingReadError("read_move_preferences_failed");
  return new Set((data ?? []).filter((row) => row.never_suggest_move).map((row) => row.behavior_id));
}
