import { beforeEach, describe, expect, it, vi } from "vitest";
import { stored } from "./helpers/behavior-graph-fixture";
import type { LocalBehaviorGraph, LocalCommandMap } from "../apps/desktop/src/local-store";
import { createLocalBehaviorActions } from "../apps/desktop/src/local-actions";
import type { Profile } from "../lib/types/database";

// Ended and Paused on the Mac (Ticket 342): End now, Start again, Pause and Resume now
// write one local configuration revision through the shared core rule, then refresh so
// generation removes or restores rows.
const command = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));

const { category: _category, schedules: nestedSchedules, schedule_slots: slots, ...storedBehavior } = stored;
void _category;
const fixture: LocalBehaviorGraph & { revision: number } = {
  behavior: { ...storedBehavior, archive_notes: storedBehavior.archive_notes ?? [],
    end_on: null, end_time: null, pause_from_on: null, pause_from_time: null, pause_back_on: null },
  schedules: nestedSchedules!.map(({ schedule_slots: _slots, ...schedule }) => { void _slots; return schedule; }),
  slots,
  revision: 3,
} as LocalBehaviorGraph & { revision: number };
let current: LocalBehaviorGraph & { revision: number };
const profile = { id: "owner", timezone: "America/New_York" } as Profile;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2:07:30 PM in New York on Nov 20, 2026.
  vi.setSystemTime(new Date("2026-11-20T19:07:30Z"));
  current = structuredClone(fixture);
  command.mockImplementation(async (operation: keyof LocalCommandMap, input: { graph?: LocalBehaviorGraph }) => {
    if (operation === "readBehaviorGraphs") return [structuredClone(current)];
    if (operation === "readCategories") return [];
    if (operation === "updateBehaviorGraph") {
      current = { ...input.graph!, revision: current.revision + 1 };
      return structuredClone(current);
    }
    throw new Error(`Unexpected operation ${operation}`);
  });
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set("behavior_id", "behavior");
  data.set("expected_updated_at", current.behavior.updated_at);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function lastCommit() {
  return command.mock.calls.filter(([operation]) => operation === "updateBehaviorGraph").at(-1)![1] as LocalCommandMap["updateBehaviorGraph"]["input"];
}

describe("Mac run actions", () => {
  it("End now stops this minute and writes one revision naming the end", async () => {
    const refresh = vi.fn();
    const { runAction } = createLocalBehaviorActions(profile, refresh);
    const result = await runAction({ status: "idle", message: "" }, form({ run_action: "end_now" }));
    expect(result).toMatchObject({ status: "success", message: "Read ended. Start again brings it back." });
    const commit = lastCommit();
    expect(commit.graph.behavior).toMatchObject({ end_on: "2026-11-20", end_time: "14:08:00" });
    expect(commit.configurationEvent).toMatchObject({ event_kind: "revision", changed_fields: ["end"], reason_code: "behavior_ended" });
    expect(commit.configurationEvent!.next_configuration).toMatchObject({ end: { on: "2026-11-20", time: "14:08:00" }, pause: null });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("Pause from today starts now, and Resume now clears it", async () => {
    const { runAction } = createLocalBehaviorActions(profile, vi.fn());
    const paused = await runAction({ status: "idle", message: "" },
      form({ run_action: "pause", pause_from_on: "2026-11-20", pause_back_on: "2026-11-24" }));
    expect(paused).toMatchObject({ status: "success", message: "Read is paused, back Nov 24." });
    expect(lastCommit().graph.behavior).toMatchObject({ pause_from_on: "2026-11-20", pause_from_time: "14:07:00", pause_back_on: "2026-11-24" });
    expect(lastCommit().configurationEvent).toMatchObject({ changed_fields: ["pause"] });
    const resumed = await runAction({ status: "idle", message: "" }, form({ run_action: "resume" }));
    expect(resumed).toMatchObject({ status: "success" });
    expect(lastCommit().graph.behavior).toMatchObject({ pause_from_on: null, pause_from_time: null, pause_back_on: null });
  });

  it("refuses a pause with no back-on day and writes nothing", async () => {
    const refresh = vi.fn();
    const { runAction } = createLocalBehaviorActions(profile, refresh);
    const result = await runAction({ status: "idle", message: "" }, form({ run_action: "pause", pause_from_on: "2026-11-20" }));
    expect(result.status).toBe("error");
    expect(command.mock.calls.some(([operation]) => operation === "updateBehaviorGraph")).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
