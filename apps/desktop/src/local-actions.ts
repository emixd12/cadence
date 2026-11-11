import { parseOccurrenceId, parseOccurrenceNote, parseOccurrenceStatus } from "@cadence/core/services/occurrence.service";
import type { OccurrenceFormAction, TimeTrackingFormAction } from "../../../lib/types/timeline";
import { markLocalOccurrence, saveLocalOccurrenceNote, trackLocalOccurrence } from "./local-occurrence.service";
import { Temporal } from "@js-temporal/polyfill";
import {
  createBehavior, setBehaviorActive, updateBehavior, updateBehaviorArchiveNote,
} from "@cadence/core/services/behavior.service";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { behaviorErrorToActionState, parseBehaviorFormData } from "../../../lib/services/behavior-form";
import type { BehaviorFormAction } from "../../../lib/types/behavior";
import type { Profile } from "../../../lib/types/database";
import { createLocalBehaviorStore, withNativeReminderSummary } from "./local-behavior.service";
import { localCommand } from "./local-store";
import { saveLocalDayNote } from "./local-day-note.service";
import { createLocalNoteShortcutStore } from "./local-note-shortcut.service";
import { matchRepeatedNoteShortcuts } from "@cadence/core/services/note-shortcut.service";

export function createLocalOccurrenceActions(profileId: string, refresh: () => void) {
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
      }, Temporal.Now.instant());
      return { status: "success", message: result.note === null ? "Day note cleared." : "Day note saved." };
    } catch (error) { return { status: "error", message: localErrorMessage(error) }; }
  };
  return { statusAction, noteAction, dayNoteAction, startTimeTrackingAction: timing("start"),
    stopTimeTrackingAction: timing("stop"), resetTimeTrackingAction: timing("reset") };
}

export function localErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error ? error.message : "Unable to save the local change. Try again.";
}

export function createLocalBehaviorActions(profile: Profile, refresh: () => void) {
  const createAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const values = parseBehaviorFormData(form, { mode: "create", categories });
      const behavior = await createBehavior(createLocalBehaviorStore(profile.id, now), {
        userId: profile.id, timezone: profile.timezone, values, recordedAt: now.toString(),
      });
      refresh();
      return { status: "success", message: "Behavior created.", behavior: withNativeReminderSummary(toBehaviorView(behavior)) };
    } catch (error) { return behaviorErrorToActionState(error); }
  };
  const updateAction: BehaviorFormAction = async (_previous, form) => {
    try {
      const now = Temporal.Now.instant();
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const values = parseBehaviorFormData(form, { mode: "update", categories });
      const expected = form.get("expected_updated_at");
      if (typeof expected !== "string" || !expected) throw new Error("Reload this behavior before saving changes.");
      await updateBehavior(createLocalBehaviorStore(profile.id, now), {
        behaviorId: values.behaviorId, expectedUpdatedAt: expected, values, recordedAt: now.toString(),
        newArchiveNoteId: crypto.randomUUID(),
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
        behaviorId, active, expectedUpdatedAt, recordedAt: now.toString(),
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
  return { createAction, updateAction, archiveAction: lifecycle(false), restoreAction: lifecycle(true), archiveNoteAction };
}
