import { parseOccurrenceId, parseOccurrenceNote, parseOccurrenceStatus } from "@cadence/core/services/occurrence.service";
import type { OccurrenceFormAction, TimeTrackingFormAction } from "../../../lib/types/timeline";
import { markLocalOccurrence, markLocalParentSlot, recordLocalDoneAt, recordLocalNotDoneReason, saveLocalOccurrenceNote, trackLocalOccurrence } from "./local-occurrence.service";
import type { MarkDetailState, OccurrenceMarkDetailActions } from "@/components/timeline/OccurrenceMarkDetails";
import { Temporal } from "@js-temporal/polyfill";
import {
  answerBehaviorAlongsideQuestion, applyBehaviorRunAction, createBehavior, createBehaviorGroup, reorderSubBehaviors, setBehaviorActive, updateBehavior,
  updateBehaviorArchiveNote,
} from "@cadence/core/services/behavior.service";
import { noticeText } from "@cadence/core/notices";
import { hasDraftSubBehaviors, parseBehaviorGroupFormData } from "@/components/behaviors/sub-behavior-form-data";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { behaviorErrorToActionState, parseBehaviorFormData, parseBehaviorRunActionFormData } from "../../../lib/services/behavior-form";
import type { BehaviorFormAction } from "../../../lib/types/behavior";
import { behaviorRunOutcomeMessage, localDateIn } from "../../../lib/ui/behavior-run";
import type { Profile } from "../../../lib/types/database";
import { createLocalBehaviorStore, withNativeReminderSummary } from "./local-behavior.service";
import { localCommand } from "./local-store";
import { saveLocalDayNote } from "./local-day-note.service";
import { createLocalNoteShortcutStore } from "./local-note-shortcut.service";
import { matchRepeatedNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import type { OpportunityFormAction } from "../../../lib/types/timeline";
import {
  OPPORTUNITY_FAILED, REMOVE_OPPORTUNITY_PARSE_REFUSAL, addOpportunityParseRefusal, opportunityResultState,
  parseAddOpportunityFormData, parseRemoveOpportunityFormData,
} from "../../../lib/services/opportunity-placement";
import { addLocalOpportunity, removeLocalOpportunity } from "./local-opportunity.service";

/**
 * `options.alongside` (Ticket 363): the Timeline row's "Done alongside other things?
 * Yes · No" writes the Behavior's answer through the local store, one configuration
 * revision, synced like any other edit. Without it no row asks.
 */
export function createLocalOccurrenceActions(profileId: string, refresh: () => void, options: Readonly<{ alongside?: boolean }> = {}) {
  const statusAction: OccurrenceFormAction = async (_previous, form) => {
    try {
      const nextStatus = parseOccurrenceStatus(form.get("status"));
      await markLocalOccurrence(profileId, {
        occurrenceId: parseOccurrenceId(form.get("occurrence_id")),
        expectedStatus: parseOccurrenceStatus(form.get("expected_status"), true), nextStatus,
      });
      // StatusButtons refreshes after completion feedback, preserving the chime.
      return { status: "success", message: "Occurrence updated.", nextStatus };
    } catch (error) { return { status: "error", message: localErrorMessage(error) }; }
  };
  // Sub-behaviors: one form marks every sub-behavior Occurrence of a routine slot.
  const parentSlotStatusAction: OccurrenceFormAction = async (_previous, form) => {
    try {
      const nextStatus = parseOccurrenceStatus(form.get("status"));
      const parentBehaviorId = form.get("parent_behavior_id");
      if (typeof parentBehaviorId !== "string" || !parentBehaviorId) throw new Error("Choose a routine to mark.");
      await markLocalParentSlot(profileId, {
        parentBehaviorId, nextStatus,
        occurrenceIds: form.getAll("occurrence_id").map((value) => parseOccurrenceId(value)),
      });
      return { status: "success", message: noticeText("sub-behaviors.routine-marked"), nextStatus };
    } catch (error) { return { status: "error", message: localErrorMessage(error) }; }
  };
  const noteAction: OccurrenceFormAction = async (_previous, form) => {
    try {
      const occurrence = await saveLocalOccurrenceNote(profileId, {
        occurrenceId: parseOccurrenceId(form.get("occurrence_id")),
        expectedNote: parseOccurrenceNote(form.get("expected_note"), true),
        note: parseOccurrenceNote(form.get("note")),
        ...(form.get("used_shortcut") === "true" ? { usedShortcut: true } : {}),
      });
      // Ticket 305: propose repeated Notes after the save; a failure never fails the Note.
      try {
        await matchRepeatedNoteShortcuts(createLocalNoteShortcutStore(profileId), occurrence.behavior_id, Temporal.Now.instant());
      } catch { /* The next save tries again. */ }
      return { status: "success", message: "Note saved." };
    } catch (error) { return { status: "error", message: localErrorMessage(error) }; }
  };
  const timing = (operation: "start" | "stop" | "reset"): TimeTrackingFormAction => async (_previous, form) => {
    const id = form.get("client_action_id");
    const request = typeof id === "string" && /^[a-z0-9-]{1,80}$/i.test(id) ? { requestId: id } : {};
    try {
      const result = await trackLocalOccurrence(profileId, parseOccurrenceId(form.get("occurrence_id")), operation);
      refresh();
      return { status: "success", message: operation === "reset" ? "Tracked time reset." : `Time tracking ${operation === "start" ? "started" : "stopped"}.`,
        tracking: { recordedSeconds: result.tracking.recordedSeconds, runningStartedAt: result.tracking.runningSession?.startedAt ?? null }, ...request };
    } catch (error) { return { status: "error", message: localErrorMessage(error), ...request }; }
  };
  const dayNoteAction: OccurrenceFormAction = async (_previous, form) => {
    try {
      const result = await saveLocalDayNote(profileId, {
        localDate: form.get("local_date"), expectedNote: form.get("expected_note"), note: form.get("note"),
        ...(form.get("used_shortcut") === "true" ? { usedShortcut: true } : {}),
      }, Temporal.Now.instant());
      // Ticket 305 applied to day notes (Ticket 292): propose repeated day notes after the save,
      // and prune unsupported proposals when a day note is cleared.
      if (result.changed) {
        try {
          await matchRepeatedNoteShortcuts(createLocalNoteShortcutStore(profileId), DAY_NOTE_SHORTCUT_POOL_ID, Temporal.Now.instant());
        } catch { /* The next save tries again. */ }
      }
      return { status: "success", message: result.note === null ? "Day note cleared." : "Day note saved." };
    } catch (error) { return { status: "error", message: localErrorMessage(error) }; }
  };
  // Advisor plan 4G: "Done at" and "Why?" lines after a mark, stored locally and synced.
  const detail = async (save: () => Promise<unknown>): Promise<MarkDetailState> => {
    try {
      await save();
      refresh();
      return { status: "saved" };
    } catch (error) { return { status: "refused", message: localErrorMessage(error) }; }
  };
  const markDetailActions: OccurrenceMarkDetailActions = {
    doneAt: (input) => detail(() => recordLocalDoneAt(profileId, input)),
    notDoneReason: (input) => detail(() => recordLocalNotDoneReason(profileId, input)),
    ...(options.alongside ? { alongside: async (input: Readonly<{ occurrenceId: string; behaviorId: string; alongside: boolean }>): Promise<MarkDetailState> => {
      let outcome: string | undefined;
      const state = await detail(async () => {
        const now = Temporal.Now.instant();
        const answer = await answerBehaviorAlongsideQuestion(createLocalBehaviorStore(profileId, now), { behaviorId: input.behaviorId, alongside: input.alongside, recordedAt: now.toString() });
        // Audit fix 7: answered elsewhere (a sync, another surface) since the row asked.
        if (answer.alreadyAnswered) outcome = noticeText("alongside.answer-already", { answer: answer.alongside ? "yes" : "no" });
      });
      return state.status === "saved" && outcome ? { status: "saved", outcome } : state;
    } } : {}),
  };
  // Behaviors of Opportunity: the basket's add and Done now, and a row's Remove, on the
  // local store. A success refreshes the Timeline so the added or removed row shows.
  const addOpportunityAction: OpportunityFormAction = async (_previous, form) => {
    const input = parseAddOpportunityFormData(form);
    if (!input) return addOpportunityParseRefusal(form);
    try {
      const result = await addLocalOpportunity(profileId, input);
      if (result.outcome !== "refused") refresh();
      return opportunityResultState(result);
    } catch { return OPPORTUNITY_FAILED; }
  };
  const removeOpportunityAction: OpportunityFormAction = async (_previous, form) => {
    const input = parseRemoveOpportunityFormData(form);
    if (!input) return REMOVE_OPPORTUNITY_PARSE_REFUSAL;
    try {
      const result = await removeLocalOpportunity(profileId, input);
      if (result.outcome !== "refused") refresh();
      return opportunityResultState(result);
    } catch { return OPPORTUNITY_FAILED; }
  };
  return { statusAction, parentSlotStatusAction, noteAction, dayNoteAction, startTimeTrackingAction: timing("start"),
    stopTimeTrackingAction: timing("stop"), resetTimeTrackingAction: timing("reset"), markDetailActions,
    addOpportunityAction, removeOpportunityAction };
}

export function localErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error) return error.message;
  // Supabase and PostgREST return plain objects ({ message, code, details, hint }).
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return "Unable to save the local change. Try again.";
}

/** `options.alongside` (Ticket 363): read the Behavior form's alongside field when it is shown. */
export function createLocalBehaviorActions(profile: Profile, refresh: () => void, options: Readonly<{ alongside?: boolean }> = {}) {
  const readAlongside = options.alongside === true;
  const createAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const store = createLocalBehaviorStore(profile.id, now);
      const newId = () => crypto.randomUUID();
      if (hasDraftSubBehaviors(form)) {
        const created = await createBehaviorGroup(store, {
          ...parseBehaviorGroupFormData(form), userId: profile.id, timezone: profile.timezone, recordedAt: now.toString(), newId,
        });
        refresh();
        return { status: "success",
          message: noticeText("sub-behaviors.group-created", { title: created.parent.title, count: created.subBehaviors.length }),
          behavior: withNativeReminderSummary(toBehaviorView(created.parent, now)) };
      }
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const values = parseBehaviorFormData(form, { mode: "create", categories, readAlongside });
      const behavior = await createBehavior(store, {
        userId: profile.id, timezone: profile.timezone, values, recordedAt: now.toString(), newId,
      });
      refresh();
      return { status: "success", message: "Behavior created.", behavior: withNativeReminderSummary(toBehaviorView(behavior, now)) };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  const updateAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const values = parseBehaviorFormData(form, { mode: "update", categories, readAlongside });
      const expected = form.get("expected_updated_at");
      if (typeof expected !== "string" || !expected) throw new Error("Reload this behavior before saving changes.");
      await updateBehavior(createLocalBehaviorStore(profile.id, now), {
        behaviorId: values.behaviorId, expectedUpdatedAt: expected, values, recordedAt: now.toString(),
        newArchiveNoteId: crypto.randomUUID(), newId: () => crypto.randomUUID(),
      });
      refresh();
      return { status: "success", message: "Behavior saved." };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  const lifecycle = (active: boolean): BehaviorFormAction => async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const behaviorId = form.get("behavior_id");
      if (typeof behaviorId !== "string" || !behaviorId) throw new Error("Choose an existing behavior.");
      const expectedUpdatedAt = form.get("expected_updated_at");
      if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) throw new Error("Reload this behavior before saving changes.");
      const archiveNote = form.get("archive_note");
      if (!active && typeof archiveNote !== "string") throw new Error("Archive note must be text.");
      await setBehaviorActive(createLocalBehaviorStore(profile.id, now), {
        behaviorId, active, expectedUpdatedAt, recordedAt: now.toString(), newId: () => crypto.randomUUID(),
        ...(active ? {} : { archiveNote: archiveNote as string, newArchiveNoteId: crypto.randomUUID() }),
      });
      refresh();
      return { status: "success", message: active ? "Behavior restored." : "Behavior archived." };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  const archiveNoteAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const behaviorId = form.get("behavior_id");
      const archiveNoteId = form.get("archive_note_id");
      const expectedUpdatedAt = form.get("expected_updated_at");
      const note = form.get("archive_note_remove") === "1" ? "" : form.get("archive_note");
      if (typeof behaviorId !== "string" || !behaviorId) throw new Error("Choose an existing behavior.");
      if (typeof archiveNoteId !== "string" || !archiveNoteId) throw new Error("Choose an archive note to edit.");
      if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) throw new Error("Reload this behavior before saving changes.");
      if (typeof note !== "string") throw new Error("Archive note must be text.");
      await updateBehaviorArchiveNote(createLocalBehaviorStore(profile.id, now), {
        behaviorId, archiveNoteId, expectedUpdatedAt, note, recordedAt: now.toString(),
      });
      refresh();
      return { status: "success", message: "Archive note saved." };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  /**
   * Ended and Paused: End now, Start again, Pause and Resume now write one local
   * configuration revision, the same rule the web uses. The refresh regenerates
   * Occurrences, so stopped rows leave the Timeline and restarted ones come back.
   */
  const runAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const behaviorId = form.get("behavior_id");
      if (typeof behaviorId !== "string" || !behaviorId) throw new Error("Choose an existing behavior.");
      const expectedUpdatedAt = form.get("expected_updated_at");
      if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) throw new Error("Reload this behavior before saving changes.");
      const action = parseBehaviorRunActionFormData(form);
      const updated = await applyBehaviorRunAction(createLocalBehaviorStore(profile.id, now), {
        behaviorId, action, expectedUpdatedAt, recordedAt: now.toString(),
      });
      refresh();
      return { status: "success", message: behaviorRunOutcomeMessage(updated.title, action, localDateIn(updated.timezone)) };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  /** Sibling order under one parent: parent_behavior_id and repeated sub_behavior_id. */
  const reorderAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const parentBehaviorId = form.get("parent_behavior_id");
      if (typeof parentBehaviorId !== "string" || !parentBehaviorId) throw new Error("Choose a parent Behavior.");
      await reorderSubBehaviors(createLocalBehaviorStore(profile.id, Temporal.Now.instant()), {
        parentBehaviorId,
        orderedBehaviorIds: form.getAll("sub_behavior_id").filter((value): value is string => typeof value === "string"),
      });
      refresh();
      return { status: "success", message: noticeText("sub-behaviors.reordered") };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  return { createAction, updateAction, archiveAction: lifecycle(false), restoreAction: lifecycle(true), archiveNoteAction, runAction, reorderAction };
}
