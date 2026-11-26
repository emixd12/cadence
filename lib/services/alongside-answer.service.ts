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
 * Refuses while `CADENCE_ALONGSIDE` is off: nothing reads or writes the setting then.
 */

export type AlongsideAnswerErrorCode = "unavailable" | "not_found" | "revision_changed";

export class AlongsideAnswerError extends Error {
  constructor(readonly code: AlongsideAnswerErrorCode) {
    super(noticeText(code === "not_found" ? "alongside.answer-not-found" : code === "revision_changed" ? "alongside.answer-changed" : "alongside.answer-unavailable"));
    this.name = "AlongsideAnswerError";
  }
}

export type AlongsideAnswerResult = Readonly<{ behaviorId: string; alongside: boolean; changed: boolean }>;

export async function recordBehaviorAlongsideAnswer(
  supabase: AppSupabaseClient,
  userId: string,
  input: Readonly<{ behaviorId: string; alongside: boolean; recordedAt?: string; env?: Readonly<Record<string, string | undefined>> }>,
): Promise<AlongsideAnswerResult> {
  if (!alongsideEnabled(input.env)) throw new AlongsideAnswerError("unavailable");
  const current = await getBehaviorById(supabase, userId, input.behaviorId);
  if (!current) throw new AlongsideAnswerError("not_found");
  // The same answer again (another surface, a second tap) changes nothing.
  if ((current as { alongside?: boolean | null }).alongside === input.alongside) {
    return { behaviorId: current.id, alongside: input.alongside, changed: false };
  }
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
