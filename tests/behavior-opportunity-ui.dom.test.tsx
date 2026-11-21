// @vitest-environment jsdom
import { LinkProvider, RefreshProvider } from "@cadence/ui/runtime";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BehaviorForm } from "../components/behaviors/BehaviorForm";
import { BehaviorList } from "../components/behaviors/BehaviorList";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { noticeText } from "@cadence/core/notices";
import type { AnalyticsOccurrenceInput } from "../lib/types/analytics";
import type { BehaviorView } from "../lib/types/behavior";
import { parseBehaviorFormData } from "../lib/services/behavior-form";
import { storedBehavior } from "./helpers/export-row-fixture";

// Behaviors of Opportunity on /behaviors: the form toggle, No fixed schedule, the
// Opportunity group and the scheduled-only adherence. "Today" is Nov 20, 2026 in New York.
const NOW = Temporal.Instant.from("2026-11-20T14:00:00Z");
const NO_SCHEDULE = noticeText("opportunity.no-schedule");

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

function view(id: string, title: string, fields: Record<string, unknown>): BehaviorView {
  return toBehaviorView({ ...storedBehavior(), id, title, ...fields } as ReturnType<typeof storedBehavior>, NOW);
}

const unscheduledFields = { is_opportunity: true, recurrence_rule: null, scheduled_time: null };
const scheduled = view("00000000-0000-4000-8000-000000000001", "Brush teeth", {});
const dualMode = view("00000000-0000-4000-8000-000000000002", "Stretch", { is_opportunity: true });
const unscheduled = view("00000000-0000-4000-8000-000000000003", "Call a friend", unscheduledFields);
const unscheduledPaused = view("00000000-0000-4000-8000-000000000004", "Sketch", { ...unscheduledFields, pause_from_on: "2026-11-18", pause_back_on: "2026-12-08" });
const unscheduledEnded = view("00000000-0000-4000-8000-000000000005", "Swim", { ...unscheduledFields, end_on: "2026-11-19" });

const unchanged = async <T,>(state: T) => state;

function form(): HTMLFormElement {
  const element = container.querySelector("form");
  expect(element).toBeTruthy();
  return element!;
}

function opportunityBox(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[type="checkbox"][name="is_opportunity"]')!;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label);
}

async function clickButton(label: string) {
  const target = button(label);
  expect(target, label).toBeTruthy();
  await act(async () => { target!.click(); });
}

async function toggleOpportunity() {
  await act(async () => { opportunityBox().click(); });
}

function parsed(mode: "create" | "update") {
  const data = new FormData(form());
  if (!data.get("title")) data.set("title", "Call a friend");
  return parseBehaviorFormData(data, { mode, categories: [] });
}

function renderForm(mode: "create" | "edit", behavior?: BehaviorView, allowOpportunity?: boolean) {
  return act(() => root.render(
    <BehaviorForm key={`${mode}-${behavior?.id ?? "new"}`} mode={mode} action={unchanged} categories={[]} behavior={behavior}
      showActiveToggle={false} allowOpportunity={allowOpportunity} />,
  ));
}

function occurrence(id: string, behavior: BehaviorView, fields: Partial<AnalyticsOccurrenceInput>): AnalyticsOccurrenceInput {
  return {
    id, behaviorId: behavior.id, behaviorTitle: behavior.title, behaviorCreatedAt: "2026-11-01T12:00:00Z",
    categoryName: "No category", scheduledFor: "2026-11-19T15:00:00Z", scheduledTimeLabel: "10:00 AM",
    localDate: "2026-11-19", status: "completed", note: "", timezone: "America/New_York", ...fields,
  };
}

function renderList(activeBehaviors: BehaviorView[], occurrences: AnalyticsOccurrenceInput[] = []) {
  return act(() => root.render(
    <LinkProvider component={(props) => <a {...props} />}>
      <RefreshProvider onRefresh={() => undefined}>
        <BehaviorList
          activeBehaviors={activeBehaviors}
          archivedBehaviors={[]}
          categories={[]}
          analytics={resolveAnalytics({ occurrences, now: NOW, timezone: "America/New_York" })}
          updateAction={unchanged} archiveAction={unchanged} restoreAction={unchanged} archiveNoteAction={unchanged}
          statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
        />
      </RefreshProvider>
    </LinkProvider>,
  ));
}

function section(titleId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`section[aria-labelledby="${titleId}"]`);
}

describe("Behavior form: Available as an opportunity", () => {
  it("posts the hidden false before the checkbox, so off and on both parse", async () => {
    await renderForm("create");
    const fields = [...form().querySelectorAll<HTMLInputElement>('[name="is_opportunity"]')];
    expect(fields.map((field) => field.type)).toEqual(["hidden", "checkbox"]);
    expect(parsed("create").isOpportunity).toBe(false);

    await toggleOpportunity();
    expect(parsed("create").isOpportunity).toBe(true);
    expect(parsed("create").schedules).toHaveLength(1);
  });

  it("switches to No fixed schedule and back on create", async () => {
    await renderForm("create");
    expect(button("No fixed schedule")).toBeUndefined();
    await toggleOpportunity();
    await clickButton("No fixed schedule");

    expect(container.textContent).toContain(NO_SCHEDULE);
    expect(form().querySelector<HTMLInputElement>('[name="behavior_schedule_count"]')!.value).toBe("0");
    expect(form().querySelector('select[name="reminder_offset"]')).toBeNull();
    expect(form().querySelector<HTMLInputElement>('input[type="hidden"][name="reminder_offset"]')!.value).toBe("0");
    expect(parsed("create")).toMatchObject({ isOpportunity: true, schedules: [] });

    await clickButton("Add schedule");
    expect(container.textContent).not.toContain(NO_SCHEDULE);
    expect(parsed("create").schedules).toHaveLength(1);
    expect(form().querySelector('select[name="reminder_offset"]')).toBeTruthy();
  });

  it("brings back a schedule when the flag goes off with none", async () => {
    await renderForm("create");
    await toggleOpportunity();
    await clickButton("No fixed schedule");
    await toggleOpportunity();

    expect(opportunityBox().checked).toBe(false);
    expect(container.textContent).not.toContain(NO_SCHEDULE);
    expect(parsed("create")).toMatchObject({ isOpportunity: false });
    expect(parsed("create").schedules).toHaveLength(1);
  });

  it("opens an unscheduled Behavior with no schedule rows and keeps it on save", async () => {
    await renderForm("edit", unscheduled);
    expect(opportunityBox().checked).toBe(true);
    expect(container.textContent).toContain(NO_SCHEDULE);
    expect(button("No fixed schedule")).toBeUndefined();
    expect(parsed("update")).toMatchObject({ isOpportunity: true, schedules: [] });
  });

  it("turns a scheduled Behavior into dual mode on edit", async () => {
    await renderForm("edit", scheduled);
    expect(opportunityBox().checked).toBe(false);
    await toggleOpportunity();
    expect(parsed("update").isOpportunity).toBe(true);
    expect(parsed("update").schedules.length).toBeGreaterThan(0);
  });

  it("hides the choice where the runtime cannot store it, keeping the stored flag", async () => {
    await renderForm("edit", unscheduled, false);
    expect(opportunityBox()).toBeNull();
    expect(parsed("update")).toMatchObject({ isOpportunity: true, schedules: [] });

    await renderForm("create", undefined, false);
    expect(container.querySelector('[name="is_opportunity"]')).toBeNull();
    expect(parsed("create").isOpportunity).toBeUndefined();
  });
});

describe("Behavior list: Opportunity group and adherence", () => {
  it("hides the Opportunity group when no running Behavior is unscheduled", async () => {
    await renderList([scheduled, dualMode, unscheduledPaused, unscheduledEnded]);
    expect(section("opportunity-behaviors-title")).toBeNull();
    const notRunning = section("not-running-behaviors-title")!;
    expect(notRunning.textContent).toContain("Sketch");
    expect(notRunning.textContent).toContain("Swim");
  });

  it("lists running unscheduled Behaviors under Opportunity, open, below the running list", async () => {
    await renderList([scheduled, dualMode, unscheduled, unscheduledPaused]);
    const group = section("opportunity-behaviors-title")!;
    expect(group).toBeTruthy();
    expect(group.querySelector("details")!.open).toBe(true);
    expect(group.querySelector("summary")!.textContent).toBe("Opportunity (1)");
    expect(group.textContent).toContain("Call a friend");
    expect(group.textContent).not.toContain("Sketch");

    const running = section("active-behaviors-title")!;
    expect(running.textContent).not.toContain("Call a friend");
    expect(running.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.compareDocumentPosition(section("not-running-behaviors-title")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks a dual-mode Behavior in Running with a quiet Opportunity label", async () => {
    await renderList([scheduled, dualMode]);
    const titles = [...section("active-behaviors-title")!.querySelectorAll("article h3")];
    const stretch = titles.find((title) => title.textContent === "Stretch")!.parentElement!;
    const brush = titles.find((title) => title.textContent === "Brush teeth")!.parentElement!;
    expect(stretch.textContent).toBe("StretchOpportunity");
    expect(brush.textContent).toBe("Brush teeth");
  });

  it("keeps overall adherence scheduled-only and counts opportunity completions apart", async () => {
    await renderList([scheduled, unscheduled], [
      occurrence("s1", scheduled, { status: "completed" }),
      occurrence("s2", scheduled, { status: "not_completed", localDate: "2026-11-18", scheduledFor: "2026-11-18T15:00:00Z" }),
      occurrence("o1", unscheduled, { origin: "opportunity" }),
      occurrence("o2", unscheduled, { origin: "opportunity", localDate: "2026-11-18", scheduledFor: "2026-11-18T15:00:00Z" }),
    ]);
    const overall = section("overall-adherence-title")!;
    expect(overall.textContent).toContain("Overall adherence:50%");
    expect(overall.querySelector('[data-testid="opportunity-completed-count"]')!.textContent).toBe("+2 opportunity Completed");

    const card = section("opportunity-behaviors-title")!.querySelector("article")!;
    expect(card.textContent).toContain("Done 2 times");
    expect(card.textContent).not.toContain("Adherence");
    expect(card.textContent).not.toMatch(/\d+%|—%/);
  });

  it("shows Done 0 times and no extra count when nothing was added", async () => {
    await renderList([scheduled, unscheduled], [occurrence("s1", scheduled, { status: "completed" })]);
    expect(section("overall-adherence-title")!.querySelector('[data-testid="opportunity-completed-count"]')).toBeNull();
    const card = section("opportunity-behaviors-title")!.querySelector("article")!;
    expect(card.textContent).toContain("Done 0 times");
    expect(card.textContent).not.toContain("Adherence");
  });
});
