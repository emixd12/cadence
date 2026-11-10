import { Temporal } from "@js-temporal/polyfill";
import { expect, it, vi } from "vitest";
import { loadLocalTimeline } from "../apps/desktop/src/local-timeline.service";

const mocks = vi.hoisted(() => ({ command: vi.fn(), fresh: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command }));
vi.mock("../apps/desktop/src/local-generation.service", async (original) => ({
  ...await original<typeof import("../apps/desktop/src/local-generation.service")>(),
  ensureLocalOccurrencesFresh: mocks.fresh,
}));

it("loads the visible window and prior unresolved occurrences with bounded duration history", async () => {
  mocks.command.mockImplementation(async (operation: string) => {
    if (operation === "readProfile") return { id: "owner", timezone: "America/New_York" };
    if (operation === "readBehaviorGraphs" || operation === "readCategories" || operation === "readOccurrences" || operation === "readDayNotes") return [];
    if (operation === "readOccurrenceHistory") return { statusEvents: [], timeSessions: [] };
    throw new Error(operation);
  });

  await loadLocalTimeline(7, Temporal.Instant.from("2026-08-30T16:00:00Z"));

  expect(mocks.command).toHaveBeenCalledWith("readOccurrences", {
    profileId: "owner", startLocalDate: "2026-08-30", endLocalDate: "2026-09-29",
  });
  expect(mocks.command).toHaveBeenCalledWith("readOccurrences", {
    profileId: "owner", startLocalDate: "2026-06-01", endLocalDate: "2026-08-29",
  });
  expect(mocks.command).toHaveBeenCalledWith("readOccurrences", {
    profileId: "owner", startLocalDate: "0001-01-01", endLocalDate: "2026-08-29", status: "unresolved",
  });
});
