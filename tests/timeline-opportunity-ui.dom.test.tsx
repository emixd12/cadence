// @vitest-environment jsdom
import { RefreshProvider } from "@cadence/ui/runtime";
import { noticeText } from "@cadence/core/notices";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Timeline } from "@/components/timeline/Timeline";
import { parseAddOpportunityFormData, parseRemoveOpportunityFormData } from "@/lib/services/opportunity.service";
import type {
  OpportunityActionState,
  TimelineDaySection,
  TimelineOccurrenceView,
  TimelineOpportunityPoolItem,
  TimelineView,
} from "@/lib/types/timeline";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Behaviors of Opportunity on the Timeline: the basket, Add to today, Done now, the
// row's Added line and Remove. "Now" is 10:00 AM on Nov 20, 2026 in New York.
const NOW = "2026-11-20T15:00:00Z";
const TODAY = "2026-11-20";
const STRETCH = "00000000-0000-4000-8000-0000000000a1";
const CALL = "00000000-0000-4000-8000-0000000000a2";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.tagName === "SECTION" ? 0 : 60;
    const height = this.tagName === "SECTION" ? 400 : 40;
    return { top, bottom: top + height, left: 160, right: 760, width: 600, height, x: 160, y: top, toJSON() {} };
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

const idle = vi.fn(async () => ({ status: "idle" as const, message: "" }));

type Action = (state: OpportunityActionState, formData: FormData) => Promise<OpportunityActionState>;

async function render(timeline: TimelineView, actions: Readonly<{ add?: Action; remove?: Action }> = {}) {
  await act(() => root.render(<RefreshProvider onRefresh={() => {}}>
    <Timeline timeline={timeline} statusAction={idle} noteAction={idle} startTimeTrackingAction={idle}
      stopTimeTrackingAction={idle} resetTimeTrackingAction={idle}
      dayProgress={{ events: [], freshness: { state: "current", refreshedAt: NOW, label: "Calendar current", canAssertNoOverlap: true }, now: NOW }}
      addOpportunityAction={actions.add} removeOpportunityAction={actions.remove} />
  </RefreshProvider>));
}

function pool(): TimelineOpportunityPoolItem[] {
  return [
    { behaviorId: CALL, title: "Call a friend", categoryName: "People", defaultDurationMinutes: 20, whereKind: "anywhere",
      locationText: null, onToday: false, lengthMinutes: 20,
      suggestedStart: { startsAt: "2026-11-20T15:05:00Z", localTime: "10:05", source: "now" } },
    { behaviorId: STRETCH, title: "Stretch", categoryName: "Fitness", defaultDurationMinutes: null, whereKind: "place",
      locationText: "Studio", onToday: true, lengthMinutes: 30,
      suggestedStart: { startsAt: "2026-11-20T17:30:00Z", localTime: "12:30", source: "free_slot" } },
  ];
}

function row(fields: Partial<TimelineOccurrenceView> & Pick<TimelineOccurrenceView, "id" | "localDate">): TimelineOccurrenceView {
  return {
    behaviorId: STRETCH, title: "Stretch", scheduledFor: `${fields.localDate}T14:00:00Z`, scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact", status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
    expandedStatusActionLabel: "Set status", visualTone: "default", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false,
    description: "", categoryName: "Fitness", scheduleSummary: "", note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
    origin: "scheduled", addedBy: null, canRemove: false,
    ...fields,
  };
}

function section(kind: TimelineDaySection["kind"], localDate: string, occurrences: TimelineOccurrenceView[]): TimelineDaySection {
  return {
    key: `${kind}-${localDate}`, kind, localDate, label: localDate, relativeLabel: kind === "today" ? "Today" : "", emptyMessage: "Nothing.",
    unresolvedOccurrenceCount: occurrences.filter((item) => item.status === "unresolved").length, occurrences,
    occurrenceGroups: occurrences.map((item) => ({ key: item.id, behaviorId: item.behaviorId, title: item.title, occurrences: [item], isGroupedStack: false })),
  };
}

function timeline(fields: Partial<TimelineView> = {}, today: TimelineOccurrenceView[] = [], prior: TimelineOccurrenceView[] = []): TimelineView {
  return {
    opportunityPool: pool(), timezone: "America/New_York", todayLocalDate: TODAY, visibleFutureDays: 0, maxFutureDays: 30, nextFutureDays: null,
    needsDecision: { title: "Needs decision", emptyMessage: "No prior unresolved occurrences.", occurrenceCount: prior.length,
      daySections: prior.length ? [section("needs_decision_day", "2026-11-19", prior)] : [] },
    daySections: [section("today", TODAY, today)],
    ...fields,
  };
}

function trigger(): HTMLButtonElement | null {
  return [...container.querySelectorAll<HTMLButtonElement>("[data-opportunity-basket] > button")][0] ?? null;
}

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function item(behaviorId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-opportunity-item="${behaviorId}"]`);
  if (!element) throw new Error(`Missing item ${behaviorId}`);
  return element;
}

function recordingAction(result: (formData: FormData) => OpportunityActionState) {
  const calls: FormData[] = [];
  const action = vi.fn(async (_state: OpportunityActionState, formData: FormData) => {
    calls.push(formData);
    return result(formData);
  });
  return { action, calls };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("Opportunity Basket", () => {
  it("is hidden when the pool is empty or no add action is injected", async () => {
    await render(timeline({ opportunityPool: [] }), { add: vi.fn() });
    expect(trigger()).toBeNull();
    await render(timeline());
    expect(trigger()).toBeNull();
  });

  it("opens under today's date, lists the pool and closes with Close or Escape, returning focus", async () => {
    await render(timeline(), { add: vi.fn() });
    const open = trigger()!;
    expect(open.textContent).toBe("Opportunity (2)");
    expect(open.closest("section")?.getAttribute("aria-labelledby")).toBe(`today-${TODAY}-title`);
    await act(() => open.click());
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(open.getAttribute("aria-controls")!)!;
    expect(panel.textContent).toContain("Call a friend");
    expect(item(CALL).textContent).toContain("20 min · Anywhere");
    expect(item(STRETCH).textContent).toContain("30 min · Studio");
    expect(item(STRETCH).querySelector("[data-on-today]")?.textContent).toBe("On today");
    expect(item(CALL).querySelector("[data-on-today]")).toBeNull();

    await act(() => panel.querySelector<HTMLButtonElement>('[aria-label="Close opportunities"]')!.click());
    expect(document.getElementById(open.getAttribute("aria-controls")!)).toBeNull();
    expect(document.activeElement).toBe(open);

    await act(() => open.click());
    (document.body as HTMLElement).focus();
    await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(open);
  });

  it("adds at the suggested exact time, or in a window preset, with a fresh client id", async () => {
    const { action, calls } = recordingAction((formData) => ({
      status: "added", occurrenceId: String(formData.get("client_occurrence_id")), noticeId: "opportunity.added",
      noticeParams: { title: "Call a friend", time: "10:05 AM" },
    }));
    await render(timeline(), { add: action });
    await act(() => trigger()!.click());
    await act(() => buttonIn(item(CALL), "Add to today").click());
    const time = item(CALL).querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(time.value).toBe("10:05");
    await act(() => buttonIn(item(CALL), "Add").click());
    await flush();
    const exact = parseAddOpportunityFormData(calls[0]!);
    expect(exact).toMatchObject({ behaviorId: CALL, placement: { kind: "exact", startTime: "10:05" } });
    expect(exact?.occurrenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(item(CALL).querySelector('[data-notice="opportunity.added"]')?.textContent)
      .toBe(noticeText("opportunity.added", { title: "Call a friend", time: "10:05 AM" }));
    // The selector closes after an add.
    expect(item(CALL).querySelector("form")).toBeNull();

    await act(() => buttonIn(item(CALL), "Add to today").click());
    const windowChoice = [...item(CALL).querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.value === "window")!;
    await act(() => windowChoice.click());
    // 10:05 sits in the morning preset.
    expect(item(CALL).querySelector("select")!.value).toBe("morning");
    await act(() => buttonIn(item(CALL), "Add").click());
    await flush();
    const preset = parseAddOpportunityFormData(calls[1]!);
    expect(preset).toMatchObject({ behaviorId: CALL, placement: { kind: "preset", preset: "morning" } });
    expect(preset?.occurrenceId).not.toBe(exact?.occurrenceId);
  });

  it("recomputes the default time around today's calendar events", async () => {
    await act(() => root.render(<RefreshProvider onRefresh={() => {}}>
      <Timeline timeline={timeline()} statusAction={idle} noteAction={idle} startTimeTrackingAction={idle}
        stopTimeTrackingAction={idle} resetTimeTrackingAction={idle} addOpportunityAction={vi.fn()}
        dayProgress={{ events: [busyEvent("2026-11-20T15:00:00Z", "2026-11-20T16:00:00Z")],
          freshness: { state: "current", refreshedAt: NOW, label: "Calendar current", canAssertNoOverlap: true }, now: NOW }} />
    </RefreshProvider>));
    await act(() => trigger()!.click());
    await act(() => buttonIn(item(CALL), "Add to today").click());
    // A busy 10:00–11:00 event plus the 10-minute gap: the first free start is 11:10.
    expect(item(CALL).querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe("11:10");
  });

  it("logs Done now with a new client id per tap and shows the logged notice or a refusal", async () => {
    let refuse = false;
    const { action, calls } = recordingAction((formData): OpportunityActionState => refuse
      ? { status: "refused", reason: "not_running", noticeId: "opportunity.refused.not-running", noticeParams: { title: "Call a friend" } }
      : { status: "logged", occurrenceId: String(formData.get("client_occurrence_id")), noticeId: "opportunity.logged", noticeParams: { title: "Call a friend", time: "10:00 AM" } });
    await render(timeline(), { add: action });
    await act(() => trigger()!.click());
    await act(() => buttonIn(item(CALL), "Done now").click());
    await flush();
    expect(item(CALL).querySelector('[data-notice="opportunity.logged"]')?.textContent)
      .toBe(noticeText("opportunity.logged", { title: "Call a friend", time: "10:00 AM" }));
    refuse = true;
    await act(() => buttonIn(item(CALL), "Done now").click());
    await flush();
    expect(calls.map((formData) => formData.get("placement"))).toEqual(["done_now", "done_now"]);
    const ids = calls.map((formData) => parseAddOpportunityFormData(formData)?.occurrenceId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(item(CALL).querySelector('[data-notice="opportunity.refused.not-running"]')?.textContent)
      .toContain(noticeText("opportunity.refused.not-running", { title: "Call a friend" }));
  });
});

describe("Added rows", () => {
  const added = row({ id: "00000000-0000-4000-8000-0000000000b1", localDate: TODAY, origin: "opportunity", addedBy: "user", canRemove: true });
  const fromBrief = row({ id: "00000000-0000-4000-8000-0000000000b2", localDate: TODAY, origin: "opportunity", addedBy: "daily_brief", canRemove: false, note: "Kept." });
  const scheduled = row({ id: "00000000-0000-4000-8000-0000000000b3", localDate: TODAY, title: "Brush teeth" });
  const prior = row({ id: "00000000-0000-4000-8000-0000000000b4", localDate: "2026-11-19", origin: "opportunity", addedBy: "chat",
    canRemove: true, visualTone: "needs_decision", isVisibleInNeedsDecision: true });

  function article(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`article[data-occurrence-id="${id}"]`);
    if (!element) throw new Error(`Missing row ${id}`);
    return element;
  }

  it("shows who added a row, and nothing on a scheduled row", async () => {
    await render(timeline({}, [added, fromBrief, scheduled]), { remove: vi.fn() });
    expect(article(added.id).querySelector('[data-notice="opportunity.added-from"]')?.textContent).toBe(noticeText("opportunity.added-from", { source: "user" }));
    expect(article(fromBrief.id).querySelector('[data-notice="opportunity.added-from"]')?.textContent).toBe("Added from Daily Brief");
    expect(article(scheduled.id).querySelector('[data-notice="opportunity.added-from"]')).toBeNull();
  });

  it("offers Remove only when canRemove is true and an action is injected", async () => {
    await render(timeline({}, [added, fromBrief, scheduled]), { remove: vi.fn() });
    expect(article(added.id).querySelector("[data-opportunity-remove]")).not.toBeNull();
    expect(article(fromBrief.id).querySelector("[data-opportunity-remove]")).toBeNull();
    expect(article(scheduled.id).querySelector("[data-opportunity-remove]")).toBeNull();
    await render(timeline({}, [added]));
    expect(article(added.id).querySelector("[data-opportunity-remove]")).toBeNull();
  });

  it("removes from today and from Needs decision, with removed and refused notices", async () => {
    let refuse = false;
    const { action, calls } = recordingAction((formData): OpportunityActionState => refuse
      ? { status: "refused", reason: "kept", noticeId: "opportunity.remove-refused.kept", noticeParams: { title: String(formData.get("title")) } }
      : { status: "removed", occurrenceId: String(formData.get("occurrence_id")), noticeId: "opportunity.removed", noticeParams: { title: String(formData.get("title")) } });
    await render(timeline({}, [added], [prior]), { remove: action });

    await act(() => buttonIn(article(added.id), "Remove").click());
    await flush();
    expect(parseRemoveOpportunityFormData(calls[0]!)).toEqual({ occurrenceId: added.id, title: "Stretch" });
    expect(article(added.id).querySelector('[data-notice="opportunity.removed"]')?.textContent).toBe(noticeText("opportunity.removed", { title: "Stretch" }));

    const openDecisions = [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
      .find((element) => element.getAttribute("aria-label")?.includes("decision"))!;
    await act(() => openDecisions.click());
    refuse = true;
    await act(() => buttonIn(article(prior.id), "Remove").click());
    await flush();
    expect(parseRemoveOpportunityFormData(calls[1]!)?.occurrenceId).toBe(prior.id);
    expect(article(prior.id).querySelector('[data-notice="opportunity.remove-refused.kept"]')?.textContent)
      .toContain(noticeText("opportunity.remove-refused.kept", { title: "Stretch" }));
  });
});

function busyEvent(startAt: string, endAt: string) {
  return {
    id: "event-standup", providerEventId: "event-standup", logicalInstanceId: "event-standup", calendarId: "calendar-1", source: "google_calendar" as const,
    calendarName: "Work", sourceTimezone: "America/New_York", sourceTimezoneFallback: "none" as const, state: "confirmed" as const, availability: "busy" as const,
    currentUserResponse: null, revision: { availability: "available" as const, providerUpdatedAt: null, providerEtag: null }, title: "Standup", description: "",
    location: "", sourceUrl: "https://calendar.google.com/", fieldAvailability: {}, detailCompleteness: {}, organizer: null, attendees: null, attendeesOmitted: false,
    conference: null, recurrence: null, attachments: null, kind: "timed" as const, startAt, endAt, endUnspecified: false,
    duration: { kind: "known" as const, seconds: 3600 },
  };
}
