import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localCommand = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation-1" }),
}));
vi.mock("../apps/desktop/src/local-note-shortcut.service", () => ({
  createLocalNoteShortcutStore: (profileId: string) => ({ userId: profileId, readStates: async () => [] }),
}));

import { createLocalPeriodActions, readLocalPeriodList, withPeriodNoteShortcuts } from "../apps/desktop/src/local-period.service";
import { PERIOD_NOTE_SHORTCUT_KEY } from "@cadence/core/resolvers/period.resolver";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";
import { noticeText } from "@cadence/core/notices";
import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

const id = "37400000-0000-4000-8000-000000000001";
const row = (overrides: Record<string, unknown> = {}) => ({ id, user_id: "profile-1", label: "Sick", start_on: "2026-11-03", end_on: null,
  note: null, revision: 1, created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-03T12:00:00Z", ...overrides });
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const idle = { status: "idle", message: "" } as const;
const commands = () => localCommand.mock.calls.map(([operation]) => operation);

let refresh: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  localCommand.mockReset();
  refresh = vi.fn<() => void>();
  vi.useFakeTimers({ now: new Date("2026-11-10T03:30:00Z") });
  return () => vi.useRealTimers();
});

describe("local Period actions (Ticket 374)", () => {
  it("adds a Period from the web's form fields and refreshes", async () => {
    localCommand.mockResolvedValue(row());
    const state = await createLocalPeriodActions("profile-1", refresh).save(idle, form({ label: " Sick ", start_on: "2026-11-03", end_on: "", note: "" }));
    expect(state).toEqual({ status: "success", noticeId: "period.saved", message: noticeText("period.saved") });
    expect(localCommand).toHaveBeenCalledWith("createPeriod", expect.objectContaining({ profileId: "profile-1", label: "Sick", startOn: "2026-11-03", endOn: null, note: null }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("edits a Period and keeps its note when the form has no note field", async () => {
    localCommand.mockResolvedValueOnce(row({ note: "Stayed home" })).mockResolvedValueOnce(row({ label: "Flu", note: "Stayed home", revision: 2 }));
    const state = await createLocalPeriodActions("profile-1", refresh).save(idle,
      form({ period_id: id, expected_revision: "1", label: "Flu", start_on: "2026-11-03", end_on: "" }));
    expect(state.status).toBe("success");
    expect(localCommand).toHaveBeenLastCalledWith("updatePeriod", expect.objectContaining({ periodId: id, expectedRevision: 1, label: "Flu", note: "Stayed home" }));
  });

  it("ends a Period on today's date in the profile timezone at the time of the write", async () => {
    localCommand.mockImplementation(async (operation: string) => operation === "readProfile" ? { id: "profile-1", timezone: "America/New_York" }
      : operation === "readPeriod" ? row() : row({ end_on: "2026-11-09", revision: 2 }));
    const state = await createLocalPeriodActions("profile-1", refresh).end(idle, form({ period_id: id, expected_revision: "1" }));
    expect(state).toMatchObject({ status: "success", noticeId: "period.ended" });
    // 03:30 UTC on November 10 is still November 9 in New York.
    expect(localCommand).toHaveBeenLastCalledWith("updatePeriod", expect.objectContaining({ endOn: "2026-11-09", expectedRevision: 1 }));
  });

  it("removes a Period and names the conflict notice on a stale write, without refreshing", async () => {
    localCommand.mockResolvedValueOnce(id);
    const actions = createLocalPeriodActions("profile-1", refresh);
    expect(await actions.remove(idle, form({ period_id: id, expected_revision: "1" }))).toMatchObject({ status: "success", noticeId: "period.removed" });
    expect(refresh).toHaveBeenCalledTimes(1);
    localCommand.mockResolvedValueOnce(null);
    expect(await actions.remove(idle, form({ period_id: id, expected_revision: "1" })))
      .toEqual({ status: "error", noticeId: "period.conflict", message: noticeText("period.conflict") });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a rule sentence or the limit as written and hides store text", async () => {
    const actions = createLocalPeriodActions("profile-1", refresh);
    const broken = await actions.save(idle, form({ label: "", start_on: "2026-11-03", end_on: "", note: "" }));
    expect(broken.status).toBe("error");
    expect(broken.message).not.toBe("Unable to save this period.");
    expect(commands()).toEqual([]);
    localCommand.mockRejectedValueOnce(new Error(PERIOD_LIMIT_MESSAGE));
    expect((await actions.save(idle, form({ label: "Sick", start_on: "2026-11-03", end_on: "", note: "" }))).message).toBe(PERIOD_LIMIT_MESSAGE);
    localCommand.mockRejectedValueOnce(new Error("UNIQUE constraint failed: periods.id Sick"));
    expect(await actions.save(idle, form({ label: "Sick", start_on: "2026-11-03", end_on: "", note: "" })))
      .toEqual({ status: "error", message: "Unable to save this period." });
  });

  it("saves the note on its own and returns the new revision", async () => {
    localCommand.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ note: "Stayed home", revision: 2 }));
    const actions = createLocalPeriodActions("profile-1", refresh);
    expect(await actions.saveNote(idle, form({ period_id: id, expected_note: "", note: "Stayed home" }))).toEqual({ status: "success", message: "", revision: 2 });
    localCommand.mockResolvedValueOnce(row({ note: "Changed elsewhere", revision: 3 }));
    expect(await actions.saveNote(idle, form({ period_id: id, expected_note: "", note: "Mine" })))
      .toEqual({ status: "error", message: noticeText("period.conflict") });
  });

  it("reads the Behaviors list: newest first, with label suggestions", async () => {
    localCommand.mockResolvedValue([row(), row({ id: "37400000-0000-4000-8000-000000000002", label: "Trip", start_on: "2026-11-20" })]);
    const list = await readLocalPeriodList("profile-1", Temporal.Instant.from("2026-11-28T12:00:00Z"));
    expect(list.periods.map(({ label }) => label)).toEqual(["Trip", "Sick"]);
    expect(list.periods[0]).not.toHaveProperty("user_id");
    expect(list.labelSuggestions).toEqual(["Trip", "Sick"]);
    expect(list.noteShortcuts).toEqual([]);
    expect(localCommand).toHaveBeenCalledWith("readPeriods", { profileId: "profile-1" });
  });

  it("adds Period note chips to the Timeline shortcut map under their own key", () => {
    const chip = { id: "chip-1" } as unknown as NoteShortcut;
    const inline = { "behavior-1": [chip] };
    expect(withPeriodNoteShortcuts(inline, [])).toBe(inline);
    expect(withPeriodNoteShortcuts(inline, [chip])).toEqual({ "behavior-1": [chip], [PERIOD_NOTE_SHORTCUT_KEY]: [chip] });
  });
});
