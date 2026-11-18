import {
  BRIEF_MOVE_ROUTES,
  type BehaviorMovePreference,
  type BriefMoveAnswerRequest,
  type BriefMoveAnswerResponse,
  type BriefMoveLengthRequest,
  type BriefMoveLengthResponse,
  type BriefMoveReplanRequest,
  type BriefMoveReplanResponse,
} from "@cadence/core/types/brief-moves";

/**
 * Advisor plan Phase 3: the brief's move answers, one transport for the web (3B) and
 * Cadence for Mac (3C). The shared brief UI calls `DailyBriefClient.moves`; each
 * platform only supplies how a request reaches the hosted API. Errors surface as
 * `DailyBriefRequestError` with the route's `{ error }` code (`BriefMoveErrorCode`).
 *
 * After an answer that changed the Timeline, `onTimelineChanged` runs: the web
 * refreshes its server-rendered Timeline, the Mac pulls the move through account sync.
 */
export type BriefMoveClient = Readonly<{
  answer: (request: BriefMoveAnswerRequest, signal?: AbortSignal) => Promise<BriefMoveAnswerResponse>;
  replan: (request: BriefMoveReplanRequest, signal?: AbortSignal) => Promise<BriefMoveReplanResponse>;
  length: (request: BriefMoveLengthRequest, signal?: AbortSignal) => Promise<BriefMoveLengthResponse>;
  /** "Don't suggest moving this" (PUT). */
  preference: (input: Readonly<{ behaviorId: string; neverSuggestMove: boolean }>, signal?: AbortSignal) => Promise<BehaviorMovePreference>;
  /** The current switch for Behavior settings (GET). */
  readPreference: (behaviorId: string, signal?: AbortSignal) => Promise<BehaviorMovePreference>;
}>;

/** Answers are single database writes; the ceiling only bounds a stalled network. */
export const DAILY_BRIEF_MOVE_DEADLINE_MS = 15_000;

/** The brief request's opt-in for move lines (BRIEF_MOVE_LINES_FEATURE), for clients that render them. */
export const DAILY_BRIEF_MOVE_FEATURES = Object.freeze(["move_lines_v1"] as const);

type MoveRequest = <T>(path: string, init: RequestInit, signal?: AbortSignal) => Promise<T>;

/** Answer kinds that can change the Timeline (a move, an Undo or a Completed mark). */
const TIMELINE_ANSWERS = new Set<BriefMoveAnswerRequest["kind"]>(["yes", "other_time", "already_done", "undo", "accept_all", "undo_all"]);

export function createBriefMoveClient(
  request: MoveRequest,
  onTimelineChanged: () => void = () => undefined,
): BriefMoveClient {
  return {
    answer: async (body, signal) => {
      const response = await request<BriefMoveAnswerResponse>(BRIEF_MOVE_ROUTES.answer, { method: "POST", body: JSON.stringify(body) }, signal);
      if (TIMELINE_ANSWERS.has(body.kind) && response.results.some((result) => result.outcome === "applied")) onTimelineChanged();
      return response;
    },
    replan: (body, signal) => request<BriefMoveReplanResponse>(BRIEF_MOVE_ROUTES.replan, { method: "POST", body: JSON.stringify(body) }, signal),
    length: async (body, signal) => {
      const response = await request<BriefMoveLengthResponse>(BRIEF_MOVE_ROUTES.length, { method: "POST", body: JSON.stringify(body) }, signal);
      // The Behavior's default length changed on the server; the Mac's copy arrives by sync.
      onTimelineChanged();
      return response;
    },
    preference: (body, signal) =>
      request<BehaviorMovePreference>(BRIEF_MOVE_ROUTES.preference, { method: "PUT", body: JSON.stringify(body) }, signal),
    readPreference: (behaviorId, signal) =>
      request<BehaviorMovePreference>(`${BRIEF_MOVE_ROUTES.preference}?behaviorId=${encodeURIComponent(behaviorId)}`, {}, signal),
  };
}
