import {
  BRIEF_ALONGSIDE_QUESTION_FEATURE,
  BRIEF_ALONGSIDE_ROUTE,
  type BriefAlongsideAnswerRequest,
  type BriefAlongsideAnswerResponse,
} from "@cadence/core/types/brief-alongside";

/**
 * Ticket 360 (D33): the brief's alongside question answers. Only clients that render the
 * question set this transport and send `alongside_question_v1`, so a client without it
 * (Cadence for Mac until Ticket 363) never receives the line.
 */
export type BriefAlongsideClient = Readonly<{
  answer: (request: BriefAlongsideAnswerRequest, signal?: AbortSignal) => Promise<BriefAlongsideAnswerResponse>;
}>;

/** The brief request's opt-in for the alongside question line. */
export const DAILY_BRIEF_ALONGSIDE_FEATURES = Object.freeze([BRIEF_ALONGSIDE_QUESTION_FEATURE] as const);

type Request = <T>(path: string, init: RequestInit, signal?: AbortSignal) => Promise<T>;

export function createBriefAlongsideClient(request: Request, onBehaviorChanged: () => void = () => undefined): BriefAlongsideClient {
  return {
    answer: async (body, signal) => {
      const response = await request<BriefAlongsideAnswerResponse>(BRIEF_ALONGSIDE_ROUTE, { method: "POST", body: JSON.stringify(body) }, signal);
      if (response.changed) onBehaviorChanged();
      return response;
    },
  };
}
