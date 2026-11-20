// @vitest-environment jsdom
import { LinkProvider, RefreshProvider } from "@cadence/ui/runtime";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BehaviorList } from "../components/behaviors/BehaviorList";
import { nextPauseRange } from "../components/behaviors/PauseRangePicker";
import { BehaviorRunNotices } from "../components/timeline/BehaviorRunNotices";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import type { BehaviorActionState, BehaviorView } from "../lib/types/behavior";
import { notRunningLabel, pauseRangeSummary, upcomingRunNote } from "../lib/ui/behavior-run";
import { storedBehavior } from "./helpers/export-row-fixture";

// Ended and Paused Behaviors on the web: the Not running group, the run controls, the
// Pause range picker and the Timeline notices (docs/RECURRENCE_RULES.md, "Behavior end
// and pause"). "Today" is Nov 20, 2026, 9:00 AM in New York.
const NOW = Temporal.Instant.from("2026-11-20T14:00:00Z");
const TODAY = "2026-11-20";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW.epochMilliseconds));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.localStorage.clear();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function view(id: string, title: string, fields: Record<string, unknown>): BehaviorView {
  return toBehaviorView({ ...storedBehavior(), id, title, ...fields } as ReturnType<typeof storedBehavior>, NOW);
}

const running = view("running", "Morning walk", {});
const endingLater = view("ending", "Read", { end_on: "2026-12-31" });
const pauseAhead = view("ahead", "Stretch", { pause_from_on: "2026-12-20", pause_back_on: "2027-01-03" });
const ended = view("ended", "Run", { end_on: "2026-11-19" });
const paused = view("paused", "Guitar practice", { pause_from_on: "2026-11-18", pause_back_on: "2026-12-08" });

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((row) => (row.getAttribute("aria-label") ?? row.textContent) === label);
  expect(button, label).toBeTruthy();
  await act(async () => { button!.click(); });
}

function renderList(runAction?: (state: BehaviorActionState, form: FormData) => Promise<BehaviorActionState>) {
  const unchanged = async <T,>(state: T) => state;
  return act(() => root.render(
    <LinkProvider component={(props) => <a {...props} />}>
      <RefreshProvider onRefresh={() => undefined}>
        <BehaviorList
          activeBehaviors={[running, endingLater, pauseAhead, ended, paused]}
          archivedBehaviors={[]}
          categories={[]}
          analytics={resolveAnalytics({ occurrences: [], now: NOW, timezone: "America/New_York" })}
          updateAction={unchanged} archiveAction={unchanged} restoreAction={unchanged} archiveNoteAction={unchanged}
          statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
          runAction={runAction}
        />
      </RefreshProvider>
    </LinkProvider>,
  ));
}

describe("run labels", () => {
  it("says why an item isn't running and what is coming", () => {
    expect(ended.runState).toBe("ended");
    expect(paused.runState).toBe("paused");
    expect(notRunningLabel(ended, TODAY)).toBe("Ended Nov 19");
    expect(notRunningLabel({ ...ended, endTime: "14:00:00" }, TODAY)).toBe("Ended Nov 19, 2:00 PM");
    expect(notRunningLabel(paused, TODAY)).toBe("Paused, back Dec 8");
    expect(notRunningLabel(running, TODAY)).toBeNull();
    expect(upcomingRunNote(endingLater, TODAY)).toBe("Ends after Dec 31");
    expect(upcomingRunNote(pauseAhead, TODAY)).toBe("Paused from Dec 20, back Jan 3, 2027");
    expect(upcomingRunNote(running, TODAY)).toBeNull();
  });

  it("picks the first paused day, then the back-on day", () => {
    const start = { fromOn: TODAY, backOn: null };
    expect(nextPauseRange(start, "2026-11-19", TODAY)).toBe(start);
    expect(nextPauseRange(start, "2026-12-08", TODAY)).toEqual({ fromOn: TODAY, backOn: "2026-12-08" });
    expect(nextPauseRange(start, TODAY, TODAY)).toEqual({ fromOn: TODAY, backOn: null });
    expect(nextPauseRange({ fromOn: TODAY, backOn: "2026-12-08" }, "2026-12-20", TODAY)).toEqual({ fromOn: "2026-12-20", backOn: null });
    expect(pauseRangeSummary({ fromOn: TODAY, backOn: null }, TODAY)).toBe("Paused from today. Pick the day it comes back.");
    expect(pauseRangeSummary({ fromOn: TODAY, backOn: "2026-12-08" }, TODAY)).toBe("Paused from today, back Dec 8 (18 days off).");
  });
});

describe("Behaviors list", () => {
  it("groups ended and paused items under Not running with one-tap actions", async () => {
    const runAction = vi.fn(async (_state: BehaviorActionState, form: FormData) => {
      expect(form.get("behavior_id")).toBe("ended");
      expect(form.get("run_action")).toBe("start_again");
      expect(form.get("expected_updated_at")).toBe(ended.updatedAt);
      return { status: "success" as const, message: "Run is running again." };
    });
    await renderList(runAction);
    const group = container.querySelector('[aria-labelledby="not-running-behaviors-title"]')!;
    expect(group.querySelector("summary")!.textContent).toBe("Not running (2)");
    expect(group.querySelector("details")!.open).toBe(true);
    const titles = [...group.querySelectorAll("h3")].map((title) => title.textContent);
    expect(titles.sort()).toEqual(["Guitar practice", "Run"]);
    expect(group.textContent).toContain("Ended Nov 19");
    expect(group.textContent).toContain("Paused, back Dec 8");
    expect(group.textContent).toContain("Resume now");
    const active = container.querySelector('[aria-labelledby="active-behaviors-title"]')!;
    expect(active.textContent).toContain("Ends after Dec 31");
    expect(active.textContent).toContain("Paused from Dec 20, back Jan 3, 2027");
    expect(active.textContent).not.toContain("Guitar practice");
    expect(container.textContent).toContain("3 of 3 active behaviors; 2 of 2 not running;");

    await click("Start again");
    expect(runAction).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Run is running again.");
  });

  it("hides the run controls when no run action is given", async () => {
    await renderList();
    expect(container.textContent).toContain("Not running (2)");
    expect(container.textContent).not.toContain("Start again");
  });

  it("pauses a running item through the range picker", async () => {
    const runAction = vi.fn(async (_state: BehaviorActionState, form: FormData) => {
      expect(Object.fromEntries(form)).toMatchObject({
        behavior_id: "running", run_action: "pause", pause_from_on: TODAY, pause_back_on: "2026-12-08",
      });
      return { status: "success" as const, message: "Morning walk is paused, back Dec 8." };
    });
    await renderList(runAction);
    const article = [...container.querySelectorAll("article")].find((row) => row.querySelector("h3")?.textContent === "Morning walk")!;
    const details = article.querySelector("details")!;
    await act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(article.textContent).toContain("End now");
    const pause = [...article.querySelectorAll("button")].find((button) => button.textContent === "Pause")!;
    await act(async () => { pause.click(); });
    const save = [...article.querySelectorAll("button")].find((button) => button.textContent === "Save pause")!;
    expect(save.disabled).toBe(true);
    await click("Thursday, November 19, 2026"); // past days can't be picked
    await click("Next month");
    await click("Tuesday, December 8, 2026");
    expect(article.textContent).toContain("Paused from today, back Dec 8 (18 days off).");
    await act(async () => { save.click(); });
    expect(runAction).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Morning walk is paused, back Dec 8.");
  });

  it("refreshes again once End now's rounded end minute has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(NOW.epochMilliseconds + 20_000)); // 9:00:20 AM
    const onRefresh = vi.fn();
    const runAction = vi.fn(async () => ({ status: "success" as const, message: "Morning walk ended. Start again brings it back." }));
    const unchanged = async <T,>(state: T) => state;
    await act(() => root.render(
      <LinkProvider component={(props) => <a {...props} />}>
        <RefreshProvider onRefresh={onRefresh}>
          <BehaviorList activeBehaviors={[running]} archivedBehaviors={[]} categories={[]}
            analytics={resolveAnalytics({ occurrences: [], now: NOW, timezone: "America/New_York" })}
            updateAction={unchanged} archiveAction={unchanged} restoreAction={unchanged} archiveNoteAction={unchanged}
            statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
            runAction={runAction} />
        </RefreshProvider>
      </LinkProvider>,
    ));
    const details = container.querySelector("article details") as HTMLDetailsElement;
    await act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    await click("End now");
    expect(runAction).toHaveBeenCalledOnce();
    const afterSave = onRefresh.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(40_000); });
    expect(onRefresh.mock.calls.length).toBe(afterSave);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onRefresh.mock.calls.length).toBe(afterSave + 1);
  });

  it("shows a refused pause in the error style next to the picker", async () => {
    const runAction = vi.fn(async () => ({
      status: "error" as const, message: "Check the highlighted fields.",
      fieldErrors: { pause: "Pick a back-on day after the first paused day and after today." },
    }));
    await renderList(runAction);
    await click("Resume now");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Pick a back-on day after the first paused day and after today.");
  });
});

describe("Timeline notices", () => {
  const notices = [
    { behaviorId: "ended", title: "Run", kind: "ended" as const, backOn: null, updatedAt: "rev-1" },
    { behaviorId: "paused", title: "Guitar practice", kind: "paused" as const, backOn: "2026-12-08", updatedAt: "rev-2" },
    { behaviorId: "back", title: "Stretch", kind: "back" as const, backOn: TODAY, updatedAt: "rev-3" },
  ];

  function renderNotices(runAction?: (state: BehaviorActionState, form: FormData) => Promise<BehaviorActionState>) {
    return act(() => root.render(
      <RefreshProvider onRefresh={() => undefined}>
        <BehaviorRunNotices notices={notices} todayLocalDate={TODAY} runAction={runAction} />
      </RefreshProvider>,
    ));
  }

  it("shows one line each and remembers Close for today on this device", async () => {
    await renderNotices(async (state) => state);
    const lines = [...container.querySelectorAll("li")].map((line) => line.textContent);
    expect(lines).toEqual([
      "Run ended.Start againClose",
      "Guitar practice is paused, back Dec 8.Resume nowClose",
      "Stretch is back today.Close",
    ]);
    await click("Close notice about Stretch");
    expect(container.textContent).not.toContain("Stretch");
    expect(JSON.parse(window.localStorage.getItem("cadence.behavior-run-notices.closed.v1")!)).toEqual([`${TODAY}:back:back`]);
    await act(() => root.render(
      <RefreshProvider onRefresh={() => undefined}>
        <BehaviorRunNotices notices={notices} todayLocalDate="2026-11-21" />
      </RefreshProvider>,
    ));
    expect(container.textContent).toContain("Stretch is back today.");
  });

  it("resumes from the paused notice with the Behavior's revision", async () => {
    const runAction = vi.fn(async (_state: BehaviorActionState, form: FormData) => {
      expect(Object.fromEntries(form)).toEqual({ behavior_id: "paused", expected_updated_at: "rev-2", run_action: "resume" });
      return { status: "success" as const, message: "Guitar practice has no pause and runs as scheduled." };
    });
    await renderNotices(runAction);
    await click("Resume now");
    expect(runAction).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Guitar practice has no pause and runs as scheduled.");
  });

  it("shows text and Close only without a run action", async () => {
    await renderNotices();
    expect(container.textContent).not.toContain("Start again");
    expect(container.textContent).toContain("Close");
  });
});
