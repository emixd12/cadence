// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveExternalEventFreshness, resolveTimelineOccurrenceContext } from "@cadence/core/resolvers/timeline-context.resolver";
import type { AlongsideFormView } from "@cadence/core/resolvers/alongside.resolver";
import type { NormalizedTimedExternalEvent } from "@cadence/core/types/day-progress";
import type { PlaceLabelState } from "@cadence/core/types/place-labels";
import { RefreshProvider } from "@cadence/ui/runtime";
import { BehaviorForm } from "@/components/behaviors/BehaviorForm";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { BehaviorPlaceAssist, PlaceLabelProvider } from "@/components/travel/PlaceLabels";
import type { BehaviorActionState, BehaviorFormAction } from "@/lib/types/behavior";
import type { OccurrenceFormAction, TimeTrackingFormAction, TimelineOccurrenceView } from "@/lib/types/timeline";
import type { PlaceLabelClient } from "@/lib/ui/place-labels";

// Ticket 358 (D33): the alongside field, the Where guess line and the Timeline label.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const categories = [{ id: "category-1", name: "Health" }];
const occurrenceAction: OccurrenceFormAction = async (state) => state;
const timeAction: TimeTrackingFormAction = async (state) => state;

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
}
function field(): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>('select[name="alongside"]');
}
function button(name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find((element) => element.textContent === name);
  if (!match) throw new Error(`No ${name} button`);
  return match;
}
function form(alongside?: AlongsideFormView, action: BehaviorFormAction = async () => ({ status: "idle", message: "" })) {
  return <BehaviorForm key={alongside ? `${alongside.answer}:${alongside.guess}` : "none"} mode="create" action={action} categories={categories} alongside={alongside} />;
}

describe("Behavior form alongside field", () => {
  it("is absent without alongside data, as on the Mac and with the flag off", async () => {
    await render(form());
    expect(field()).toBeNull();
    expect(host.textContent).not.toContain("alongside");
  });

  it("shows three states with a label", async () => {
    for (const [answer, value] of [["unanswered", ""], ["yes", "yes"], ["no", "no"]] as const) {
      await render(form({ answer, guess: null }));
      const select = field()!;
      expect(select.value).toBe(value);
      expect([...select.options].map((option) => option.textContent)).toEqual(["Not answered", "Yes", "No"]);
      expect(select.closest("label")?.textContent).toContain("Can be done alongside other things");
      expect(host.querySelector("[data-alongside-guess]")).toBeNull();
    }
  });

  it("shows a guess only while unanswered, and Use the guess fills the field for Save", async () => {
    const action = vi.fn<BehaviorFormAction>(async () => ({ status: "idle", message: "" } as BehaviorActionState));
    await render(form({ answer: "unanswered", guess: true }, action));
    expect(host.querySelector("[data-alongside-guess]")?.textContent).toContain("Cadence guesses Yes. Planning uses the guess until you choose.");
    await act(async () => button("Use the guess").click());
    expect(field()!.value).toBe("yes");
    expect(host.querySelector("[data-alongside-guess]")).toBeNull();
    expect(action).not.toHaveBeenCalled();

    const formElement = host.querySelector("form")!;
    expect(new FormData(formElement).get("alongside")).toBe("yes");

    await act(async () => {
      field()!.value = "";
      field()!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector("[data-alongside-guess]")?.getAttribute("data-alongside-guess")).toBe("yes");
    expect(new FormData(formElement).get("alongside")).toBe("");
  });

  it("names a No guess as No and hides it once answered", async () => {
    await render(form({ answer: "unanswered", guess: false }));
    expect(host.querySelector("[data-alongside-guess]")?.textContent).toContain("Cadence guesses No.");
    await render(form({ answer: "no", guess: null }));
    expect(host.querySelector("[data-alongside-guess]")).toBeNull();
  });

  it("puts the Where suggestion line below Where when given one", async () => {
    await render(<BehaviorForm mode="create" action={async () => ({ status: "idle", message: "" })} categories={categories}
      whereAssist={<p data-test-where-assist>Where line</p>} />);
    const where = host.querySelector('select[name="where_kind"]')!;
    const line = host.querySelector("[data-test-where-assist]")!;
    expect(where.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Where suggestion line with a guessed Where", () => {
  const ON: PlaceLabelState = {
    settings: { enabled: true, retention: "90_days", enabledAt: "2026-10-22T12:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-22T12:00:00Z" },
    homePlaceKey: null, homeMarker: null, placeMarkers: [], labelCount: 0, behaviors: [],
  };
  const client = (state: PlaceLabelState): PlaceLabelClient => ({
    load: vi.fn(async () => state), saveSettings: vi.fn(async () => ON), recordMarker: vi.fn(async () => ON),
    removeMarkers: vi.fn(async () => ON), deleteLabels: vi.fn(async () => ON), dismissSuggestion: vi.fn(async () => ON),
    capturePlan: vi.fn(async () => null), recordLabel: vi.fn(async () => undefined), locationAllowed: vi.fn(async () => false),
    readLocation: vi.fn(async () => ({ state: "unavailable" as const })),
  });

  it("states the guess as a guess, and Review Where and Dismiss use the existing suggestion actions", async () => {
    const state: PlaceLabelState = { ...ON, behaviors: [{ behaviorId: "behavior-1", suggestedPlaceText: null, markerPrompt: null,
      suggestion: { ruleVersion: "where-suggestion-rules@1", kind: "home", key: "home", placeKey: null, labelCount: 0, supportingCount: 0, basis: "guess" } }] };
    const fake = client(state);
    const onReview = vi.fn();
    await render(<PlaceLabelProvider client={fake}><BehaviorPlaceAssist behaviorId="behavior-1" placeText={null} onReview={onReview} /></PlaceLabelProvider>);
    const line = host.querySelector("[data-where-suggestion]")!;
    expect(line.getAttribute("data-where-suggestion-basis")).toBe("guess");
    expect(line.textContent).toContain("Cadence guesses this happens at Home. Planning uses the guess until Where is set.");
    await act(async () => button("Review Where").click());
    expect(onReview).toHaveBeenCalledWith({ whereKind: "home", locationText: "" });
    await act(async () => button("Dismiss").click());
    expect(fake.dismissSuggestion).toHaveBeenCalledWith({ behaviorId: "behavior-1", suggestion: "home", ruleVersion: "where-suggestion-rules@1" });
  });

  it("keeps the label wording for a suggestion from completion places", async () => {
    const state: PlaceLabelState = { ...ON, behaviors: [{ behaviorId: "behavior-1", suggestedPlaceText: null, markerPrompt: null,
      suggestion: { ruleVersion: "where-suggestion-rules@1", kind: "anywhere", key: "anywhere", placeKey: null, labelCount: 8, supportingCount: 8 } }] };
    await render(<PlaceLabelProvider client={client(state)}><BehaviorPlaceAssist behaviorId="behavior-1" placeText={null} onReview={vi.fn()} /></PlaceLabelProvider>);
    const line = host.querySelector("[data-where-suggestion]")!;
    expect(line.hasAttribute("data-where-suggestion-basis")).toBe(false);
    expect(line.textContent).toContain("Completed in different places (8 recent completions). Anywhere may fit.");
  });
});

describe("Timeline row alongside label and overlap cue", () => {
  const NOW = Temporal.Instant.from("2026-09-16T15:00:00Z");
  const freshness = resolveExternalEventFreshness({ availability: "complete", refreshedAt: "2026-09-16T14:00:00Z",
    staleAfter: Temporal.Instant.from("2026-09-16T17:00:00Z"), now: NOW });
  const meeting: NormalizedTimedExternalEvent = {
    id: "meeting", providerEventId: "meeting", logicalInstanceId: "logical-meeting", calendarId: "calendar-1", source: "google_calendar",
    calendarName: "Work", sourceTimezone: "UTC", sourceTimezoneFallback: "request", state: "confirmed", availability: "busy",
    currentUserResponse: null, title: "Meeting", kind: "timed", startAt: "2026-09-16T16:10:00Z", endAt: "2026-09-16T17:00:00Z",
    endUnspecified: false, duration: { kind: "known", seconds: 3000 },
  } as NormalizedTimedExternalEvent;
  const occurrence = (alongside?: TimelineOccurrenceView["alongside"]): TimelineOccurrenceView => ({
    id: "occurrence-1", behaviorId: "behavior-1", title: "Red light helmet", scheduledFor: "2026-09-16T16:00:00Z",
    scheduledTimeLabel: "12:00 PM", localDate: "2026-09-16", status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved",
    statusDetail: "", expandedStatusActionLabel: "Mark", visualTone: "default", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false, description: "",
    categoryName: "Health", scheduleSummary: "Daily", note: "", timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true, ...(alongside ? { alongside } : {}),
  });
  const row = (view: TimelineOccurrenceView) => {
    const context = resolveTimelineOccurrenceContext({
      occurrenceId: view.id, scheduledFor: view.scheduledFor, runningStartedAt: null, now: NOW, freshness, events: [meeting],
      estimate: { kind: "known", seconds: 1800, durationLabel: "30m", sampleCount: 0, lookbackDays: null, provenance: "behavior_default" },
      alongside: view.alongside ?? null,
    });
    return <RefreshProvider onRefresh={() => undefined}><OccurrenceRow occurrence={view} context={context} statusAction={occurrenceAction} noteAction={occurrenceAction}
      startTimeTrackingAction={timeAction} stopTimeTrackingAction={timeAction} resetTimeTrackingAction={timeAction} /></RefreshProvider>;
  };

  it("shows no label and keeps the overlap cue for an item that is not alongside", async () => {
    await render(row(occurrence()));
    expect(host.querySelector("[data-alongside]")).toBeNull();
    expect(host.textContent).toContain("Possible overlap");
  });

  it("labels the person's answer as Alongside and stops the allowed Calendar overlap cue", async () => {
    await render(row(occurrence({ source: "person", where: { kind: "home" } })));
    expect(host.querySelector("[data-alongside]")?.textContent).toBe("Alongside");
    expect(host.querySelector("[data-alongside]")?.getAttribute("data-alongside")).toBe("person");
    expect(host.textContent).not.toContain("Possible overlap");
    expect(host.querySelector("[data-overlap-assessment]")?.getAttribute("data-overlap-assessment")).toBe("none");
  });

  it("says when the value is a guess", async () => {
    await render(row(occurrence({ source: "guess" })));
    expect(host.querySelector("[data-alongside]")?.textContent).toBe("Alongside · a guess");
  });
});
