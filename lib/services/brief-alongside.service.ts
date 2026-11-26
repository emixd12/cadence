import { pickBriefAlongsideQuestion } from "@cadence/core/resolvers/alongside.resolver";
import type { BriefAlongsideAnswerRequest, BriefAlongsideAnswerResponse, BriefAlongsideQuestion } from "@cadence/core/types/brief-alongside";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { AlongsideAnswerError, recordBehaviorAlongsideAnswer } from "@/lib/services/alongside-answer.service";
import { readAlongsideBehaviorFacts } from "@/lib/services/alongside-view.service";
import { BriefMoveError } from "@/lib/services/brief-moves.service";

/**
 * Ticket 360 (D33): the Daily Brief's one alongside question line. No model call: the
 * pick is `pickBriefAlongsideQuestion` over today's items, with each Behavior's
 * `alongsideQuestionOpen` from the one alongside reader (`readAlongsideBehaviorFacts`).
 *
 * At most one question per brief: the new brief stores its pick with the saved brief,
 * and a reopen shows that same question while it is still open, or nothing. Once per
 * Behavior: the answer is the Behavior's own setting, so an answered Behavior's
 * question is closed for good. Nothing else is stored; no new table.
 *
 * While `CADENCE_ALONGSIDE` is off every function here reads nothing and returns null.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Today's item a brief could ask about: its Behavior, title and effective start. */
export type BriefAlongsideItem = Readonly<{ behaviorId: string; title: string; localDate: string; start: Readonly<{ toString(): string }> }>;

export async function planBriefAlongsideQuestion(supabase: AppSupabaseClient, userId: string, input: Readonly<{
  localDate: string;
  items: readonly BriefAlongsideItem[];
  env?: Env;
}>): Promise<BriefAlongsideQuestion | null> {
  if (!alongsideEnabled(input.env)) return null;
  const today = input.items.filter((item) => item.localDate === input.localDate);
  if (!today.length) return null;
  const facts = await readAlongsideBehaviorFacts(supabase, userId, {
    behaviorIds: today.map((item) => item.behaviorId), localDate: input.localDate, ...(input.env ? { env: input.env } : {}),
  });
  if (!facts) return null;
  return pickBriefAlongsideQuestion({
    items: today.map((item) => ({ behaviorId: item.behaviorId, title: item.title, startAt: item.start.toString(),
      questionOpen: facts.get(item.behaviorId)?.questionOpen === true })),
  });
}

/** The saved brief's question when it reopens: shown again only while it is still open. */
export async function reopenBriefAlongsideQuestion(supabase: AppSupabaseClient, userId: string, input: Readonly<{
  localDate: string;
  saved: BriefAlongsideQuestion | null | undefined;
  env?: Env;
}>): Promise<BriefAlongsideQuestion | null> {
  if (!input.saved || !alongsideEnabled(input.env)) return null;
  const facts = await readAlongsideBehaviorFacts(supabase, userId, {
    behaviorIds: [input.saved.behaviorId], localDate: input.localDate, ...(input.env ? { env: input.env } : {}),
  });
  return facts?.get(input.saved.behaviorId)?.questionOpen === true ? { behaviorId: input.saved.behaviorId, title: input.saved.title } : null;
}

/** Yes or No on the brief's question: the Behavior's setting, as the person. */
export async function answerBriefAlongsideQuestion(person: Readonly<{ supabase: AppSupabaseClient; userId: string }>,
  request: BriefAlongsideAnswerRequest, env?: Env): Promise<BriefAlongsideAnswerResponse> {
  try {
    return await recordBehaviorAlongsideAnswer(person.supabase, person.userId, { ...request, ...(env ? { env } : {}) });
  } catch (error) {
    if (error instanceof AlongsideAnswerError) {
      throw new BriefMoveError(error.code === "not_found" ? "proposal_not_found" : error.code === "revision_changed" ? "revision_changed" : "invalid_request");
    }
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict body check for `POST /api/advisor/brief/alongside`. */
export function parseBriefAlongsideAnswer(value: unknown): BriefAlongsideAnswerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BriefMoveError("invalid_request");
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== 2 || !keys.includes("behaviorId") || !keys.includes("alongside")) throw new BriefMoveError("invalid_request");
  if (typeof item.behaviorId !== "string" || !UUID.test(item.behaviorId) || typeof item.alongside !== "boolean") throw new BriefMoveError("invalid_request");
  return { behaviorId: item.behaviorId, alongside: item.alongside };
}
