import { noticeText } from "@cadence/core/notices";
import type { AlongsideInputField, IntegrationOperationInput } from "@cadence/core/integration";
import { getBehaviorById, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
import { updateBehaviorForUser } from "@/lib/services/behavior.service";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { serializeIntegrationBehavior } from "@/lib/services/integration-read-serialization";

/**
 * Ticket 360 (D33): the one writer for an answer to "Can this be done alongside other
 * things?" from the Timeline row and the Daily Brief. It writes `behaviors.alongside`
 * through the Behavior definition service (`updateBehaviorForUser`), as the person, the
 * same path the Behavior form and the coach's schedule change use, so the answer closes
 * the question on every surface (`alongsideQuestionOpen`). Chat writes the same field
 * through its confirmed `update_behavior`. No new table.
 *
 * It answers only an unanswered Behavior: once the setting holds an answer, a prompt
 * shown before it was given writes nothing and says so. The Behavior form changes an
 * answer through its own save.
 *
 * Refuses while `CADENCE_ALONGSIDE` is off: nothing reads or writes the setting then.
 */

export type AlongsideAnswerErrorCode = "unavailable" | "not_found" | "revision_changed";

export class AlongsideAnswerError extends Error {
  constructor(readonly code: AlongsideAnswerErrorCode) {
    super(noticeText(code === "not_found" ? "alongside.answer-not-found" : code === "revision_changed" ? "alongside.answer-changed" : "alongside.answer-unavailable"));
    this.name = "AlongsideAnswerError";
  }
}

/**
 * `alongside` is the setting as stored after the call. `alreadyAnswered` (audit fix 7):
 * the Behavior already held the other answer, made elsewhere since the prompt was shown,
 * so nothing was written; the Behavior form is the place to change it.
 */
export type AlongsideAnswerResult = Readonly<{ behaviorId: string; alongside: boolean; changed: boolean; alreadyAnswered?: boolean }>;

export async function recordBehaviorAlongsideAnswer(
  supabase: AppSupabaseClient,
  userId: string,
  input: Readonly<{ behaviorId: string; alongside: boolean; recordedAt?: string; env?: Readonly<Record<string, string | undefined>> }>,
): Promise<AlongsideAnswerResult> {
  if (!alongsideEnabled(input.env)) throw new AlongsideAnswerError("unavailable");
  const current = await getBehaviorById(supabase, userId, input.behaviorId);
  if (!current) throw new AlongsideAnswerError("not_found");
  const stored = (current as { alongside?: boolean | null }).alongside ?? null;
  // The same answer again (another surface, a second tap) changes nothing.
  if (stored === input.alongside) return { behaviorId: current.id, alongside: input.alongside, changed: false };
  // Audit fix 7: a question prompt answers only an unanswered Behavior. A stale Timeline
  // row or brief line never overwrites an answer made elsewhere since it was shown.
  if (stored !== null) return { behaviorId: current.id, alongside: stored, changed: false, alreadyAnswered: true };
  const update = { behavior_id: current.id, expected_revision: current.updated_at, alongside: input.alongside } as
    IntegrationOperationInput<"update_behavior"> & AlongsideInputField;
  const values = integrationBehaviorInput(update, serializeIntegrationBehavior(current, null));
  try {
    await updateBehaviorForUser(supabase, userId, { behaviorId: current.id, values, expectedUpdatedAt: current.updated_at },
      input.recordedAt ?? new Date().toISOString());
  } catch (error) {
    if (error instanceof Error && /reload|revision|changed/i.test(error.message)) throw new AlongsideAnswerError("revision_changed");
    throw error;
  }
  return { behaviorId: current.id, alongside: input.alongside, changed: true };
}
