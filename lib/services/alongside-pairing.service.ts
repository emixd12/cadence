import { Temporal } from "@js-temporal/polyfill";
import {
  NO_ALONGSIDE_PAIRING_EVIDENCE,
  planAlongsidePairings,
  type AlongsidePairing,
  type AlongsidePairingEvidence,
} from "@cadence/core/resolvers/alongside-pairing.resolver";
import type { BriefMoveCalendarBusy } from "@cadence/core/resolvers/brief-move.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readStoredSignals } from "@/lib/db/advisor-tips.repo";
import { agentCallerConfigured, createAgentClient } from "@/lib/integrations/agent-caller";
import { readBriefMoveDay } from "@/lib/services/brief-move-day.service";

/**
 * Ticket 361 (D33): the I/O around the pairing planner
 * (packages/core/src/resolvers/alongside-pairing.resolver.ts).
 *
 * Evidence: the coach's stored `done_together` and `crowded_hour` signals live in
 * `cadence_advisor_private.coach_signals`, which only the coach agent's token channel can
 * read (`coach_read_signals`). The Daily Brief and Chat tokens cannot. Rather than widen
 * that grant, this reads them through a coach agent client for the same person, which
 * stays read-only for tracking data, and uses ids and hours only. Today's signals are
 * written in the early morning; until then yesterday's are used. Any failure (no signing
 * key, no signals, a read error) means no evidence, so pairing then needs a crowded hour
 * or a conflict. Called only while `CADENCE_ALONGSIDE` is on.
 */

export type PairingEvidenceReader = (userId: string, localDate: string) => Promise<AlongsidePairingEvidence>;

export async function readAlongsidePairingEvidence(userId: string, localDate: string,
  options: Readonly<{ client?: AppSupabaseClient; env?: Readonly<Record<string, string | undefined>> }> = {}): Promise<AlongsidePairingEvidence> {
  try {
    if (!options.client && !agentCallerConfigured(options.env as Record<string, string | undefined> | undefined)) return NO_ALONGSIDE_PAIRING_EVIDENCE;
    const client = options.client ?? createAgentClient(userId, "coach").client;
    for (const date of [localDate, Temporal.PlainDate.from(localDate).subtract({ days: 1 }).toString()]) {
      const signals = await readStoredSignals(client, date);
      if (signals.length) return pairingEvidenceFromSignals(signals);
    }
  } catch {
    // No evidence: the other two reasons still apply.
  }
  return NO_ALONGSIDE_PAIRING_EVIDENCE;
}

/** Ids and hours only, from stored signal rows. */
export function pairingEvidenceFromSignals(signals: ReadonlyArray<Readonly<{ kind: string; behaviorId: string | null; facts: Readonly<Record<string, unknown>> }>>): AlongsidePairingEvidence {
  const doneTogether: { behaviorId: string; otherBehaviorId: string }[] = [];
  const crowdedHours: number[] = [];
  for (const signal of signals) {
    if (signal.kind === "done_together" && signal.behaviorId && typeof signal.facts.other_behavior_id === "string") {
      doneTogether.push({ behaviorId: signal.behaviorId, otherBehaviorId: signal.facts.other_behavior_id });
    }
    const hour = signal.facts.hour;
    if (signal.kind === "crowded_hour" && typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23) crowdedHours.push(hour);
  }
  return { doneTogether, crowdedHours };
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
    (input.readEvidence ?? readAlongsidePairingEvidence)(input.userId, input.localDate),
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
