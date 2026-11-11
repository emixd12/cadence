import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localCommand = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation-1" }),
}));

import { createLocalDayNoteStore, saveLocalDayNote } from "../apps/desktop/src/local-day-note.service";

const now = Temporal.Instant.from("2026-11-10T12:00:00Z");
const row = (note: string | null) => ({ id: "40000000-0000-4000-8000-000000000001", user_id: "profile-1", local_date: "2026-11-10",
  note, revision: 1, created_at: now.toString(), updated_at: now.toString() });

beforeEach(() => localCommand.mockReset());

describe("local day notes", () => {
  it("sends the normalized compare-and-set plan to the native store", async () => {
    localCommand.mockResolvedValue(row("Travel day"));
    const result = await saveLocalDayNote("profile-1", { localDate: "2026-11-10", expectedNote: "", note: " Travel day " }, now);
    expect(result.note).toBe("Travel day");
    expect(localCommand).toHaveBeenCalledWith("saveDayNote", expect.objectContaining({
      profileId: "profile-1", mutationId: "mutation-1", now: now.toString(), localDate: "2026-11-10", expectedNote: null, note: "Travel day",
    }));
    expect(localCommand.mock.calls[0][1]).not.toHaveProperty("usedShortcut");
  });

  it("asks the native store to exclude a shortcut-assisted day note from the day-note pool", async () => {
    localCommand.mockResolvedValue(row("Travel day"));
    await saveLocalDayNote("profile-1", { localDate: "2026-11-10", expectedNote: "", note: "Travel day", usedShortcut: true }, now);
    expect(localCommand).toHaveBeenCalledWith("saveDayNote", expect.objectContaining({ note: "Travel day", usedShortcut: true }));
  });

  it("reports a conflict when the native store returns no row", async () => {
    localCommand.mockResolvedValue(null);
    await expect(saveLocalDayNote("profile-1", { localDate: "2026-11-10", expectedNote: "Old", note: "New" }, now))
      .rejects.toThrow("This day note changed elsewhere");
  });

  it("reads a date range", async () => {
    localCommand.mockResolvedValue([row("Sick")]);
    await createLocalDayNoteStore("profile-1", now).listDayNotes({ from: "2026-11-01", to: "2026-11-30" });
    expect(localCommand).toHaveBeenCalledWith("readDayNotes", { profileId: "profile-1", startLocalDate: "2026-11-01", endLocalDate: "2026-11-30" });
  });
});
