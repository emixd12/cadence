import type {
  BriefMoveAnswerRequest,
  BriefMoveAnswerResponse,
  BriefMoveLine,
  BriefMoveLineResult,
  BriefMoves,
} from "@cadence/core/types/brief-moves";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";
import type { BriefMoveClient } from "@/lib/ui/daily-brief-moves";

/**
 * Advisor Phase 3 (3B): static move lines for the design-system bench and tests. The
 * times are fixed instants on 2026-11-18 in New York; none of this is model text.
 */
const TIMEZONE = "America/New_York";
const DATE = "2026-11-18";
const at = (time: string) => new Date(`${DATE}T${time}:00-05:00`).toISOString();

function line(partial: Partial<BriefMoveLine> & Pick<BriefMoveLine, "proposalId" | "title" | "from" | "to" | "reason">): BriefMoveLine {
  return {
    occurrenceId: `occ-${partial.proposalId}`,
    behaviorId: `beh-${partial.proposalId}`,
    behaviorRevision: "2026-11-01T00:00:00Z",
    localDate: DATE,
    timezone: TIMEZONE,
    expectedRevision: "2026-11-18T11:00:00Z",
    length: { minutes: 30, source: "behavior_duration", assumed: false },
    reasonCode: "calendar_overlap",
    anchor: null,
    otherTimes: [at("13:00"), at("15:30"), at("19:00")],
    travel: "not_needed",
    late: false,
    offerNeverMove: false,
    status: "proposed",
    moveId: null,
    ...partial,
  };
}

export const BRIEF_MOVE_FIXTURE_LINES: readonly BriefMoveLine[] = [
  line({
    proposalId: "walk", title: "Walk",
    from: { startAt: at("09:00"), endAt: at("09:30") }, to: { startAt: at("11:30"), endAt: at("12:00") },
    reason: "Your 9:00 design review runs until 10:30, so the walk fits after it.",
    anchor: { kind: "calendar_event", title: "Design review" },
  }),
  line({
    proposalId: "gym", title: "Gym",
    from: { startAt: at("12:30"), endAt: at("13:00") }, to: { startAt: at("17:30"), endAt: at("18:00") },
    reason: "You leave for the airport at 12:15, and you’re back by 5.",
    reasonCode: "travel_overlap", anchor: { kind: "trip", title: "Airport" },
    length: { minutes: 30, source: "fallback", assumed: true }, travel: "not_checked",
  }),
  line({
    proposalId: "vitamins", title: "Vitamins",
    from: { startAt: at("08:00"), endAt: at("08:05") }, to: { startAt: at("12:15"), endAt: at("12:20") },
    reason: "8:00 has passed; lunch is the next quiet moment.",
    reasonCode: "time_passed", late: true, length: { minutes: 5, source: "logged_average", assumed: false },
    offerNeverMove: true,
  }),
];

/**
 * Ticket 361 (D33): a pairing line. The red-light helmet (alongside) goes during Reading at
 * Reading's start; Yes moves only the helmet, as an ordinary move for today.
 */
export const BRIEF_MOVE_PAIRING_LINE: BriefMoveLine = line({
  proposalId: "helmet", title: "Red light helmet",
  from: { startAt: at("19:00"), endAt: at("19:10") }, to: { startAt: at("20:00"), endAt: at("20:10") },
  reason: "Do it during Reading, while you're home anyway.",
  reasonCode: "alongside_pairing", anchor: { kind: "item", title: "Reading" },
  length: { minutes: 10, source: "behavior_duration", assumed: false }, otherTimes: [at("19:30"), at("21:00")],
  pairing: { hostOccurrenceId: "occ-reading", hostBehaviorId: "beh-reading", hostTitle: "Reading", hostStartAt: at("20:00"), needs: ["done_together"],
    // Audit fix 11: the helmet's alongside value is Cadence's guess, so the line says so.
    guesses: { alongside: true, guestWhere: false, hostWhere: false } },
});

export const BRIEF_MOVE_PAIRING_BRIEFING: DailyBriefing = {
  text: "A quiet evening. The helmet can go with your reading.",
  generatedAt: at("07:02"),
  expiresAt: at("23:59"),
  timezone: TIMEZONE,
  localDate: DATE,
  coverage: "complete",
  warnings: [],
  moves: { version: "1", localDate: DATE, timezone: TIMEZONE, runId: "run-bench-pairing", lines: [BRIEF_MOVE_PAIRING_LINE], conflicts: [],
    acceptAll: false, undoAllBatchId: null, calendar: "current" },
};

export const BRIEF_MOVE_FIXTURE: BriefMoves = {
  version: "1",
  localDate: DATE,
  timezone: TIMEZONE,
  runId: "run-bench",
  lines: BRIEF_MOVE_FIXTURE_LINES,
  conflicts: [{
    conflictId: "conflict-stretch", occurrenceId: "occ-stretch", behaviorId: "beh-stretch", title: "Stretch",
    expectedRevision: "2026-11-18T11:00:00Z", at: { startAt: at("15:00"), endAt: at("15:15") }, conflictingTitle: "Piano practice",
  }],
  acceptAll: true,
  undoAllBatchId: null,
  calendar: "current",
};

export const BRIEF_MOVE_FIXTURE_BRIEFING: DailyBriefing = {
  text: "A full morning: the design review runs long and you head to the airport at 12:15. Three items need a new time.",
  generatedAt: at("07:02"),
  expiresAt: at("23:59"),
  timezone: TIMEZONE,
  localDate: DATE,
  coverage: "complete",
  warnings: [],
  moves: BRIEF_MOVE_FIXTURE,
};

/** A client that applies every answer at once, refusing Gym's Yes to show the refusal state when asked. */
export function fixtureBriefMoveClient(options: Readonly<{ refuse?: readonly string[]; stale?: readonly string[]; delayMs?: number; lines?: readonly BriefMoveLine[] }> = {}): BriefMoveClient {
  const refuse = new Set(options.refuse ?? []);
  const lines = new Map((options.lines ?? BRIEF_MOVE_FIXTURE_LINES).map((entry) => [entry.proposalId, entry]));
  const wait = () => new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const result = (proposalId: string, kind: BriefMoveAnswerRequest["kind"], startAt?: string): BriefMoveLineResult => {
    const current = lines.get(proposalId)!;
    if (refuse.has(proposalId) && (kind === "yes" || kind === "accept_all")) {
      return {
        proposalId, outcome: "refused", line: current, moveId: null, occurrence: null,
        refusal: { reason: "slot_taken", message: `${formatFixtureTime(current.to.startAt)} is taken now: you moved Piano practice there after this brief was written.`, alternatives: [at("16:00"), at("18:30")], revision: current.expectedRevision },
      };
    }
    const status = kind === "yes" || kind === "accept_all" ? "accepted" : kind === "other_time" ? "other_time"
      : kind === "no" || kind === "never_move" ? "declined" : kind === "undo" || kind === "undo_all" ? "undone" : "already_done";
    const moved = status === "accepted" || status === "other_time";
    const next: BriefMoveLine = { ...current, status, moveId: moved ? `move-${proposalId}` : null,
      ...(kind === "never_move" ? { offerNeverMove: false } : {}) };
    lines.set(proposalId, next);
    const start = moved ? startAt ?? current.to.startAt : current.from.startAt;
    return {
      proposalId, outcome: "applied", line: next, refusal: null, moveId: next.moveId,
      occurrence: kind === "no" || kind === "never_move" ? null
        : { id: current.occurrenceId, effectiveStartAt: start, effectiveEndAt: null, revision: `${Date.now()}`, status: kind === "already_done" ? "completed" : "unresolved" },
    };
  };
  let batch: string[] = [];
  return {
    async answer(request): Promise<BriefMoveAnswerResponse> {
      await wait();
      const base = { kind: request.kind, replayed: false, showFirstMoveLine: false, batchId: null };
      if (request.kind === "accept_all") {
        const results = request.lines.map((entry) => result(entry.proposalId, "accept_all"));
        batch = results.filter((entry) => entry.outcome === "applied").map((entry) => entry.proposalId);
        return { ...base, results, batchId: "batch-bench" };
      }
      if (request.kind === "undo_all") return { ...base, results: batch.map((id) => result(id, "undo_all")) };
      return { ...base, showFirstMoveLine: request.kind === "yes", results: [result(request.proposalId, request.kind, request.kind === "other_time" ? request.startAt : undefined)] };
    },
    async replan(request) {
      await wait();
      const current = lines.get(request.proposalId)!;
      const next: BriefMoveLine = { ...current, proposalId: `${current.proposalId}-replanned`, to: { startAt: at("14:00"), endAt: at("14:30") },
        reason: "Re-planned with your calendar as it is now.", length: { ...current.length, assumed: false, source: "behavior_duration" } };
      lines.set(next.proposalId, next);
      return { line: next, replacedProposalId: request.proposalId };
    },
    async length(request) {
      await wait();
      return { behaviorId: request.behaviorId, minutes: request.minutes, revision: "2026-11-18T12:00:00Z" };
    },
    async preference(input) {
      await wait();
      return { behaviorId: input.behaviorId, neverSuggestMove: input.neverSuggestMove, updatedAt: "2026-11-18T12:00:00Z" };
    },
    async readPreference(behaviorId) {
      return { behaviorId, neverSuggestMove: false, updatedAt: null };
    },
    async recheck() {
      await wait();
      // A stale line arrives re-planned, with the reason naming what took its time.
      return { replaced: (options.stale ?? []).map((proposalId) => {
        const current = lines.get(proposalId)!;
        const next: BriefMoveLine = { ...current, proposalId: `${proposalId}-rechecked`, to: { startAt: at("18:30"), endAt: at("19:00") },
          reason: `${formatFixtureTime(current.to.startAt)} is taken now, so 6:30 PM instead.` };
        lines.set(next.proposalId, next);
        return { proposalId, line: next };
      }) };
    },
  };
}

function formatFixtureTime(instant: string): string {
  return new Date(instant).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });
}
