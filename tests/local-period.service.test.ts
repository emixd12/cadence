import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localCommand = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation-1" }),
}));

import { createLocalPeriodStore } from "../apps/desktop/src/local-period.service";
import { PERIOD_CONFLICT_MESSAGE, PERIOD_LIMIT_MESSAGE, createPeriod, deletePeriod, savePeriodNote, updatePeriod } from "@cadence/core/services/period.service";

const now = Temporal.Instant.from("2026-11-28T12:00:00Z");
const id = "37400000-0000-4000-8000-000000000001";
const row = (overrides: Record<string, unknown> = {}) => ({ id, user_id: "profile-1", label: "Sick", start_on: "2026-11-03", end_on: null,
  note: null, revision: 1, created_at: now.toString(), updated_at: now.toString(), ...overrides });
const store = () => createLocalPeriodStore("profile-1", now);

beforeEach(() => {
  localCommand.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => "37400000-0000-4000-8000-0000000000aa" });
});

describe("local Periods (Ticket 374)", () => {
  it("sends a normalized create to the native store with a new id", async () => {
    localCommand.mockResolvedValue(row());
    const result = await createPeriod(store(), { label: "  Sick ", startOn: "2026-11-03" });
    expect(result).toMatchObject({ changed: true, period: { id } });
    expect(localCommand).toHaveBeenCalledWith("createPeriod", {
      profileId: "profile-1", mutationId: "mutation-1", now: now.toString(), newId: "37400000-0000-4000-8000-0000000000aa",
      label: "Sick", startOn: "2026-11-03", endOn: null, note: null,
    });
  });

  it("reports the cap in the shared words, whatever wraps the native error", async () => {
    localCommand.mockRejectedValue(`local_store failed: ${PERIOD_LIMIT_MESSAGE}`);
    await expect(store().createPeriod({ label: "Sick", startOn: "2026-11-03", endOn: null, note: null })).rejects.toThrow(PERIOD_LIMIT_MESSAGE);
    localCommand.mockRejectedValue(new Error(PERIOD_LIMIT_MESSAGE));
    await expect(store().createPeriodIfAbsent!({ label: "Sick", startOn: "2026-11-03", endOn: null, note: null })).rejects.toThrow(PERIOD_LIMIT_MESSAGE);
    localCommand.mockRejectedValue(new Error("disk full"));
    await expect(store().createPeriod({ label: "Sick", startOn: "2026-11-03", endOn: null, note: null })).rejects.toThrow("disk full");
  });

  it("adds a Period only when its natural key is absent", async () => {
    localCommand.mockResolvedValue({ period: row(), created: false });
    expect(await store().createPeriodIfAbsent!({ label: "Sick", startOn: "2026-11-03", endOn: null, note: null })).toEqual({ period: row(), created: false });
    expect(localCommand).toHaveBeenCalledWith("createPeriodIfAbsent", expect.objectContaining({ label: "Sick", startOn: "2026-11-03", endOn: null }));
  });

  it("edits with the revision it read and reports a conflict when the store returns no row", async () => {
    localCommand.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ label: "Flu", revision: 2 }));
    expect((await updatePeriod(store(), { id, expectedRevision: 1, label: "Flu" })).period.revision).toBe(2);
    expect(localCommand).toHaveBeenNthCalledWith(1, "readPeriod", { profileId: "profile-1", periodId: id });
    expect(localCommand).toHaveBeenNthCalledWith(2, "updatePeriod", expect.objectContaining({ periodId: id, expectedRevision: 1, label: "Flu", startOn: "2026-11-03", endOn: null, note: null }));
    localCommand.mockReset();
    localCommand.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(updatePeriod(store(), { id, expectedRevision: 1, label: "Flu" })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("saves the note on its own", async () => {
    localCommand.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ note: "Stayed home", revision: 2 }));
    expect((await savePeriodNote(store(), { id, expectedNote: "", note: " Stayed home " })).period.note).toBe("Stayed home");
    expect(localCommand).toHaveBeenNthCalledWith(2, "updatePeriod", expect.objectContaining({ expectedRevision: 1, note: "Stayed home", label: "Sick" }));
  });

  it("removes with the revision it read and reports a conflict when nothing was removed", async () => {
    localCommand.mockResolvedValue(id);
    expect(await deletePeriod(store(), { id, expectedRevision: 1 })).toEqual({ id });
    expect(localCommand).toHaveBeenCalledWith("deletePeriod", { profileId: "profile-1", mutationId: "mutation-1", now: now.toString(), periodId: id, expectedRevision: 1 });
    localCommand.mockResolvedValue(null);
    await expect(deletePeriod(store(), { id, expectedRevision: 1 })).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("reads every Period, or a date range", async () => {
    localCommand.mockResolvedValue([row()]);
    await store().listPeriods();
    expect(localCommand).toHaveBeenLastCalledWith("readPeriods", { profileId: "profile-1" });
    await store().listPeriods({ from: "2026-11-01", to: "2026-11-30" });
    expect(localCommand).toHaveBeenLastCalledWith("readPeriods", { profileId: "profile-1", startLocalDate: "2026-11-01", endLocalDate: "2026-11-30" });
  });
});
