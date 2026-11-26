import { Temporal } from "@js-temporal/polyfill";
import {
  NO_ALONGSIDE_PAIRING_EVIDENCE,
  planAlongsidePairings,
  type AlongsidePairing,
  type AlongsidePairingEvidence,
} from "@cadence/core/resolvers/alongside-pairing.resolver";
import type { BriefMoveCalendarBusy } from "@cadence/core/resolvers/brief-move.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readPairingEvidence } from "@/lib/db/pairing-evidence.repo";
import { readBriefMoveDay } from "@/lib/services/brief-move-day.service";

/**
 * Ticket 361 (D33): the I/O around the pairing planner
 * (packages/core/src/resolvers/alongside-pairing.resolver.ts).
 *
 * Evidence: the coach's stored `done_together` and `crowded_hour` signals live in
 * `cadence_advisor_private.coach_signals`. The caller reads them on its own client
 * through `advisor_read_pairing_evidence`, which only the Daily Brief and Chat agent
 * channels may call and which returns ids and hours only (migration 20261126100000).
 * No other channel's client is minted here. The database picks the date: today's
 * signals once stored, else yesterday's. Any failure (no agent client, a refused or
 * failed read) means no evidence, so pairing then needs a crowded hour or a conflict.
 * Called only while `CADENCE_ALONGSIDE` is on.
 */

/** Reads the evidence on `client`, the caller's own agent client; null reads nothing. */
export type PairingEvidenceReader = (client: AppSupabaseClient | null, localDate: string) => Promise<AlongsidePairingEvidence>;

export async function readAlongsidePairingEvidence(client: AppSupabaseClient | null, localDate: string): Promise<AlongsidePairingEvidence> {
  if (!client) return NO_ALONGSIDE_PAIRING_EVIDENCE;
  try {
    return await readPairingEvidence(client, localDate);
  } catch {
    // No evidence: the other two reasons still apply.
    return NO_ALONGSIDE_PAIRING_EVIDENCE;
  }
}

/** What Chat's `plan_alongside_pairings` tool returns for one pairing. */
export type ChatPairingProposal = Readonly<{
  occurrence_id: string;
  title: string;
  expected_revision: string;
  current_start_at: string;
  /** The move to apply on the person's Yes: move_occurrence_for_day with this start. */
  start_at: string;
  start_time: string;
  host: Readonly<{ occurrence_id: string; title: string; start_at: string }>;
  helps: readonly string[];
}>;

/**
 * Chat's pairings for today. With `occurrenceId` the person asked about that item, so the
 * "helps" rule is skipped and only that guest is planned. Answers and "Don't suggest
 * moving this" are the brief's suggestion rules and do not limit an asked-for pairing.
 */
export async function planChatPairings(input: Readonly<{
  /** Chat's own agent client (channel `chat`): reads the day and the pairing evidence. */
  supabase: AppSupabaseClient;
  userId: string;
  localDate: string;
  timezone: string;
  now: Temporal.Instant;
  calendarBusy: readonly BriefMoveCalendarBusy[];
  occurrenceId?: string | null;
  readEvidence?: PairingEvidenceReader;
}>): Promise<Readonly<{ pairings: ChatPairingProposal[] }>> {
  const [day, evidence] = await Promise.all([
    readBriefMoveDay(input.supabase, input.userId, input.localDate),
    (input.readEvidence ?? readAlongsidePairingEvidence)(input.supabase, input.localDate),
  ]);
  const pairings = planAlongsidePairings({
    localDate: input.localDate, timezone: input.timezone, now: input.now, items: day.items, calendarBusy: input.calendarBusy,
    travel: null, evidence,
    ...(input.occurrenceId ? { onlyGuests: new Set([input.occurrenceId]), requireNeed: false } : { neverMoveBehaviorIds: day.neverMoveBehaviorIds }),
  });
  return { pairings: pairings.map((pairing) => chatPairingProposal(pairing, input.timezone)) };
}

/** One pairing in the shape Chat's tool returns (also used by the chat eval's fake executor). */
export function chatPairingProposal(pairing: AlongsidePairing, timezone: string): ChatPairingProposal {
  const wall = pairing.to.start.toZonedDateTimeISO(timezone);
  return {
    occurrence_id: pairing.guest.occurrenceId,
    title: pairing.guest.title,
    expected_revision: pairing.guest.revision,
    current_start_at: pairing.guest.start.toString(),
    start_at: pairing.to.start.toString(),
    start_time: `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`,
    host: { occurrence_id: pairing.host.occurrenceId, title: pairing.host.title, start_at: pairing.host.start.toString() },
    helps: pairing.needs,
  };
}
