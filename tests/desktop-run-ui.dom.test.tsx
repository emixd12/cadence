// @vitest-environment jsdom
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import type { BehaviorGraphRecord } from "@cadence/core/behavior-store";
import { BehaviorsScreen } from "../apps/desktop/src/behaviors-screen";
import { createLocalBehaviorActions, createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";
import type { LocalBehaviorGraph, LocalCommandMap } from "../apps/desktop/src/local-store";
import type { Profile } from "../lib/types/database";
import { stored } from "./helpers/behavior-graph-fixture";

// Ended and Paused on the Mac (Ticket 342): the Mac Behaviors screen renders the shared
// Not running group, and its one-tap actions write through the Mac's local store.
// "Today" is Nov 20, 2026, 9:00 AM in New York.
const command = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));

const NOW = Temporal.Instant.from("2026-11-20T14:00:00Z");
const ended = { ...stored, end_on: "2026-11-19", end_time: null, pause_from_on: null, pause_from_time: null, pause_back_on: null } as BehaviorGraphRecord;
const { category: _category, schedules: nestedSchedules, schedule_slots: slots, ...endedBehavior } = ended;
void _category;
let current: LocalBehaviorGraph & { revision: number };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW.epochMilliseconds));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  current = {
    behavior: { ...endedBehavior, archive_notes: endedBehavior.archive_notes ?? [] },
    schedules: nestedSchedules!.map(({ schedule_slots: _slots, ...schedule }) => { void _slots; return schedule; }),
    slots, revision: 4,
  } as LocalBehaviorGraph & { revision: number };
  command.mockImplementation(async (operation: keyof LocalCommandMap, input: { graph?: LocalBehaviorGraph }) => {
    if (operation === "readBehaviorGraphs") return [structuredClone(current)];
    if (operation === "readCategories") return [];
    if (operation === "updateBehaviorGraph") {
      current = { ...input.graph!, revision: current.revision + 1 };
      return structuredClone(current);
    }
    throw new Error(`Unexpected operation ${operation}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Mac Behaviors screen, Ended and Paused", () => {
  it("shows an ended item under Not running and starts it again in the local store", async () => {
    const refresh = vi.fn();
    const profile = { id: "owner", timezone: "America/New_York" } as Profile;
    const actions = { ...createLocalOccurrenceActions(profile.id, refresh), ...createLocalBehaviorActions(profile, refresh) };
    const view = toBehaviorView(ended, NOW);
    expect(view.runState).toBe("ended");
    await act(() => root.render(
      <BehaviorsScreen activeBehaviors={[view]} archivedBehaviors={[]} categories={[]}
        analytics={resolveAnalytics({ occurrences: [], now: NOW, timezone: "America/New_York" })}
        defaultTimezone="America/New_York" onRefresh={refresh} onNavigateReview={() => undefined}
        {...actions} />,
    ));
    const group = container.querySelector('[aria-labelledby="not-running-behaviors-title"]')!;
    expect(group.querySelector("summary")!.textContent).toBe("Not running (1)");
    expect(group.textContent).toContain("Ended Nov 19");
    const start = [...group.querySelectorAll("button")].find((button) => button.textContent === "Start again")!;
    await act(async () => { start.click(); });
    const commit = command.mock.calls.find(([operation]) => operation === "updateBehaviorGraph")![1] as LocalCommandMap["updateBehaviorGraph"]["input"];
    expect(commit.graph.behavior).toMatchObject({ end_on: null, end_time: null });
    expect(commit.configurationEvent).toMatchObject({ changed_fields: ["end"], reason_code: "behavior_started_again" });
    expect(container.textContent).toContain("Read is running again.");
    expect(refresh).toHaveBeenCalled();
  });
});
