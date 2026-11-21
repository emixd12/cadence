// @vitest-environment jsdom
import { noticeText } from "@cadence/core/notices";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BehaviorsScreen } from "../apps/desktop/src/behaviors-screen";
import { createLocalBehaviorActions, createLocalOccurrenceActions } from "../apps/desktop/src/local-actions";
import type { LocalCommandMap } from "../apps/desktop/src/local-store";
import { TimelineScreen } from "../apps/desktop/src/timeline-screen";
import type { Profile } from "../lib/types/database";
import type { TimelineDaySection, TimelineOccurrenceView, TimelineView } from "../lib/types/timeline";
import { stored } from "./helpers/behavior-graph-fixture";

// Behaviors of Opportunity on Cadence for Mac (Task 8): the Mac screens render the shared
// toggle, basket and Remove, and their actions write through the local store. The real
// store round trip is in desktop-opportunity-contract.test.ts. "Now" is 10:00 AM on
// Nov 20, 2026 in New York.
const command = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand: command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation" }),
}));

const NOW = "2026-11-20T15:00:00Z";
const TODAY = "2026-11-20";
const CALL = "00000000-0000-4000-8000-0000000000a1";
const ADDED = "00000000-0000-4000-8000-0000000000b1";
const profile = { id: "owner", timezone: "America/New_York" } as Profile;
const { category: _category, schedules: _schedules, schedule_slots: _slots, ...base } = stored;
void _category; void _schedules; void _slots;
const opportunity = { ...base, id: CALL, title: "Call a friend", is_opportunity: true, recurrence_rule: null, scheduled_time: null,
  current_configuration_event_id: "00000000-0000-4000-8000-0000000000c1", end_on: null, end_time: null,
  pause_from_on: null, pause_from_time: null, pause_back_on: null };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.tagName === "SECTION" ? 0 : 60;
    const height = this.tagName === "SECTION" ? 400 : 40;
    return { top, bottom: top + height, left: 160, right: 760, width: 600, height, x: 160, y: top, toJSON() {} };
  });
  command.mockImplementation(async (operation: keyof LocalCommandMap, input: Record<string, unknown>) => {
    if (operation === "readBehaviorGraphs") return [{ behavior: opportunity, schedules: [], slots: [], revision: 1 }];
    if (operation === "addOpportunityOccurrence") return { created: true, occurrence: input.occurrence, statusEvent: input.statusEvent };
    if (operation === "removeOpportunityOccurrence") throw new Error("Only an Unresolved opportunity can be removed.");
    throw new Error(`Unexpected operation ${operation}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function row(fields: Partial<TimelineOccurrenceView> & Pick<TimelineOccurrenceView, "id">): TimelineOccurrenceView {
  return {
    behaviorId: CALL, title: "Call a friend", localDate: TODAY, scheduledFor: `${TODAY}T20:00:00Z`, scheduledTimeLabel: "3:00 PM",
    scheduleKind: "exact", status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
    expandedStatusActionLabel: "Set status", visualTone: "default", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false,
    description: "", categoryName: "", scheduleSummary: "", note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
    origin: "opportunity", addedBy: "user", canRemove: true,
    ...fields,
  };
}

function timeline(today: TimelineOccurrenceView[]): TimelineView {
  const section: TimelineDaySection = {
    key: `today-${TODAY}`, kind: "today", localDate: TODAY, label: TODAY, relativeLabel: "Today", emptyMessage: "Nothing.",
    unresolvedOccurrenceCount: today.length, occurrences: today,
    occurrenceGroups: today.map((item) => ({ key: item.id, behaviorId: item.behaviorId, title: item.title, occurrences: [item], isGroupedStack: false })),
  };
  return {
    timezone: "America/New_York", todayLocalDate: TODAY, visibleFutureDays: 0, maxFutureDays: 30, nextFutureDays: null,
    needsDecision: { title: "Needs decision", emptyMessage: "No prior unresolved occurrences.", occurrenceCount: 0, daySections: [] },
    daySections: [section],
    opportunityPool: [{ behaviorId: CALL, title: "Call a friend", categoryName: "", defaultDurationMinutes: 20, whereKind: "anywhere",
      locationText: null, onToday: today.length > 0, lengthMinutes: 20, suggestedStart: { startsAt: "2026-11-20T15:05:00Z", localTime: "10:05", source: "now" } }],
  };
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function flush() {
  await act(async () => { for (let step = 0; step < 6; step += 1) await Promise.resolve(); });
}

describe("Mac Timeline, Behaviors of Opportunity", () => {
  it("logs Done now from the basket into the local store and removes through it", async () => {
    const refresh = vi.fn();
    const actions = createLocalOccurrenceActions(profile.id, refresh);
    const unchanged = vi.fn(async () => ({ status: "idle" as const, message: "" }));
    await act(() => root.render(<TimelineScreen timeline={timeline([row({ id: ADDED })])} statusAction={unchanged} noteAction={unchanged}
      startTimeTrackingAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
      onRefresh={refresh} onShowMore={vi.fn()} addOpportunityAction={actions.addOpportunityAction}
      removeOpportunityAction={actions.removeOpportunityAction} />));

    const trigger = container.querySelector<HTMLButtonElement>("[data-opportunity-basket] > button")!;
    expect(trigger.textContent).toBe("Opportunity (1)");
    await act(() => trigger.click());
    const item = container.querySelector<HTMLElement>(`[data-opportunity-item="${CALL}"]`)!;
    await act(() => button(item, "Done now").click());
    await flush();
    const add = command.mock.calls.find(([operation]) => operation === "addOpportunityOccurrence")![1] as LocalCommandMap["addOpportunityOccurrence"]["input"];
    expect(add.occurrence).toMatchObject({ behavior_id: CALL, origin: "opportunity", added_by: "user", status: "completed",
      local_date: TODAY, schedule_kind: "exact", schedule_start_time: "10:00:00", completed_at: add.now, status_marked_at: add.now });
    expect(add.statusEvent).toMatchObject({ status: "completed", status_semantics: "explicit_user_mark", source_capture_method: "manual_tap" });
    expect(Temporal.Instant.from(add.occurrence.scheduled_for).toString()).toBe("2026-11-20T15:00:00Z");
    expect(item.querySelector('[data-notice="opportunity.logged"]')?.textContent)
      .toBe(noticeText("opportunity.logged", { title: "Call a friend", time: "10:00 AM" }));
    expect(refresh).toHaveBeenCalledOnce();

    // The store's refusal message becomes the shared refusal notice; nothing refreshes.
    const article = container.querySelector<HTMLElement>(`article[data-occurrence-id="${ADDED}"]`)!;
    await act(() => button(article, "Remove").click());
    await flush();
    expect(command).toHaveBeenCalledWith("removeOpportunityOccurrence", expect.objectContaining({ occurrenceId: ADDED }));
    expect(article.querySelector('[data-notice="opportunity.remove-refused.marked"]')?.textContent)
      .toContain(noticeText("opportunity.remove-refused.marked", { title: "Call a friend" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("Mac Behaviors, Behaviors of Opportunity", () => {
  it("shows the opportunity toggle in the create form", async () => {
    const refresh = vi.fn();
    await act(() => root.render(
      <BehaviorsScreen activeBehaviors={[]} archivedBehaviors={[]} categories={[]}
        analytics={resolveAnalytics({ occurrences: [], now: Temporal.Instant.from(NOW), timezone: "America/New_York" })}
        defaultTimezone="America/New_York" onRefresh={refresh} onNavigateReview={() => undefined}
        {...createLocalOccurrenceActions(profile.id, refresh)} {...createLocalBehaviorActions(profile, refresh)} />,
    ));
    const toggle = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="is_opportunity"]')];
    expect(toggle).toHaveLength(1);
    expect(toggle[0]!.closest("label")?.textContent).toContain("Available as an opportunity");
  });
});
