// @vitest-environment jsdom
import { LinkProvider, RefreshProvider } from "@cadence/ui/runtime";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import type { PeriodView } from "@cadence/core/types/period";

import { BehaviorList } from "../components/behaviors/BehaviorList";
import type { AnalyticsOccurrenceInput } from "../lib/types/analytics";
import type { PeriodActions } from "../lib/types/period";
import { storedBehavior } from "./helpers/export-row-fixture";

// Ticket 369: Periods on /behaviors. "Today" is Nov 20, 2026 in New York.
const NOW = Temporal.Instant.from("2026-11-20T14:00:00Z");
const behavior = toBehaviorView({ ...storedBehavior(), id: "00000000-0000-4000-8000-000000000001", title: "Brush teeth" }, NOW);
const SICK: PeriodView = { id: "p-sick", label: "Sick", start_on: "2026-11-18", end_on: "2026-11-18", note: null, revision: 1 };
const TRIP: PeriodView = { id: "p-trip", label: "Trip", start_on: "2026-12-01", end_on: null, note: null, revision: 1 };

const unchanged = async <T,>(state: T) => state;
const actions: PeriodActions = { save: unchanged, end: unchanged, remove: unchanged, saveNote: unchanged };

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW.epochMilliseconds));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const on = (id: string, localDate: string, status: AnalyticsOccurrenceInput["status"]): AnalyticsOccurrenceInput => ({
  id, behaviorId: behavior.id, behaviorTitle: behavior.title, behaviorCreatedAt: "2026-11-01T12:00:00Z",
  categoryName: "No category", scheduledFor: `${localDate}T15:00:00Z`, scheduledTimeLabel: "10:00 AM",
  localDate, status, note: "", timezone: "America/New_York",
});
const OCCURRENCES = [
  on("a", "2026-11-19", "completed"), on("b", "2026-11-17", "completed"), on("c", "2026-11-16", "not_completed"),
  on("d", "2026-11-18", "not_completed"),
];

function renderList(input: { periods?: readonly PeriodView[]; withActions?: boolean }) {
  const periods = input.periods ?? [];
  return act(() => root.render(
    <LinkProvider component={(props) => <a {...props} />}>
      <RefreshProvider onRefresh={() => undefined}>
        <BehaviorList
          activeBehaviors={[behavior]}
          archivedBehaviors={[]}
          categories={[]}
          analytics={resolveAnalytics({ occurrences: OCCURRENCES, now: NOW, timezone: "America/New_York", periods })}
          updateAction={unchanged} archiveAction={unchanged} restoreAction={unchanged} archiveNoteAction={unchanged}
          statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
          periods={periods}
          periodLabelSuggestions={periods.map((period) => period.label)}
          periodActions={input.withActions === false ? undefined : actions}
        />
      </RefreshProvider>
    </LinkProvider>,
  ));
}

const overall = () => container.querySelector<HTMLElement>('section[aria-labelledby="overall-adherence-title"]')!;
const line = () => container.querySelector('[data-testid="period-adherence-line"]');

describe("Periods on Behaviors (Ticket 369)", () => {
  it("adds the outside and inside line under the unchanged overall adherence", async () => {
    await renderList({ periods: [SICK] });
    expect(overall().textContent).toContain("Overall adherence:50%");
    expect(line()?.textContent).toBe("Outside periods: 66.7% (2 of 3). In periods: 0% (0 of 1).");
    expect(overall().contains(line())).toBe(true);
  });

  it("shows no line when no Period overlaps the selected range, and still lists the Period", async () => {
    await renderList({ periods: [TRIP] });
    expect(overall().textContent).toContain("Overall adherence:50%");
    expect(line()).toBeNull();
    expect(container.querySelector("[data-period-list]")?.textContent).toContain("TripFrom Dec 1");
  });

  it("lists Periods below Category counts with End today judged against the range's last day", async () => {
    await renderList({ periods: [TRIP, { ...SICK, end_on: null }] });
    const list = container.querySelector<HTMLElement>("[data-period-list]")!;
    const categories = container.querySelector('section[aria-labelledby="category-counts-title"]')!;
    expect(categories.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...list.querySelectorAll("[data-period] p")].map((item) => item.textContent)).toEqual(["TripFrom Dec 1", "SickSince Nov 18"]);

    await act(async () => { list.querySelector<HTMLButtonElement>('button[aria-label="Edit period Sick"]')!.click(); });
    expect([...list.querySelectorAll("[data-period-editor] button")].map((item) => item.textContent?.trim()))
      .toEqual(["Save", "Close", "End today", "Remove"]);
  });

  it("hides the Periods section with no Period or no actions", async () => {
    await renderList({ periods: [] });
    expect(container.querySelector("[data-period-list]")).toBeNull();
    expect(line()).toBeNull();
    await renderList({ periods: [SICK], withActions: false });
    expect(container.querySelector("[data-period-list]")).toBeNull();
  });
});
