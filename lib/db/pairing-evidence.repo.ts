import type { AlongsidePairingEvidence } from "@cadence/core/resolvers/alongside-pairing.resolver";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Ticket 361 follow-up (D33): the pairing planner's evidence from the coach's stored
// signals, through `advisor_read_pairing_evidence` (migration 20261126100000). The
// database allows only the Daily Brief and Chat agent channels and returns, for the
// caller's own account, `done_together` pairs and `crowded_hour` hours. It picks the
// date: `localDate`, or the day before while no signal is stored for it yet.

export class PairingEvidenceError extends Error {
  constructor() {
    super("Pairing evidence read failed.");
    this.name = "PairingEvidenceError";
  }
}

const HOUR_MAX = 23;

/** Ids and hours only. Throws on a refused or failed read. */
export async function readPairingEvidence(client: AppSupabaseClient, localDate: string): Promise<AlongsidePairingEvidence> {
  const { data, error } = await client.rpc("advisor_read_pairing_evidence", { p_local_date: localDate });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new PairingEvidenceError();
  return pairingEvidenceFromRpc(data as Record<string, Json | undefined>);
}

/** The function's JSON, checked again: anything malformed is dropped. */
export function pairingEvidenceFromRpc(value: Readonly<Record<string, Json | undefined>>): AlongsidePairingEvidence {
  const doneTogether: { behaviorId: string; otherBehaviorId: string }[] = [];
  const crowdedHours: number[] = [];
  for (const row of Array.isArray(value.done_together) ? value.done_together : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (typeof row.behavior_id === "string" && typeof row.other_behavior_id === "string") {
      doneTogether.push({ behaviorId: row.behavior_id, otherBehaviorId: row.other_behavior_id });
    }
  }
  for (const hour of Array.isArray(value.crowded_hours) ? value.crowded_hours : []) {
    if (typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= HOUR_MAX) crowdedHours.push(hour);
  }
  return { doneTogether, crowdedHours };
}
