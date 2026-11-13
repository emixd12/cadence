// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { connectorTimingLabel, resolveConnectorTimingSummaries } from "@cadence/core/resolvers/analytics.resolver";
import {
  attachTimelineSourceEvidence,
  resolveTimelineSourceEvidence,
  sourceEvidenceSummary,
} from "@cadence/core/services/timeline-source-evidence";
import type { TimelineOccurrenceView, TimelineSourceEvidence } from "@cadence/core/types/timeline";
import { SourceLinkSettings } from "@/components/behaviors/SourceLinkSettings";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import type { SourceLinkFormState } from "@/lib/services/source-links.service";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { HevyCoordinator } from "@/lib/ui/connectors";
import type { SourceLinkCoordinator } from "@/lib/ui/source-links";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const BEHAVIOR = "11111111-1111-4111-8111-111111111111";
const LEGS = "a".repeat(64);
const PUSH = "b".repeat(64);

function linkState(overrides: Partial<SourceLinkFormState> = {}): SourceLinkFormState {
  return {
    source: "hevy", available: true, connected: true, mode: "off", selectorKeys: [], fenced: false,
    routines: [{ key: LEGS, title: "Legs", holder: null }, { key: PUSH, title: "Push", holder: { behaviorId: "other", title: "Chest day" } }],
    routinesComplete: true, staleLinkedCount: null, anyHolder: null, ...overrides,
  };
}

function coordinator(state: SourceLinkFormState, save = vi.fn(async () => ({ saved: true as const, mode: "routines" as const }))): SourceLinkCoordinator & { save: typeof save } {
  return { getState: vi.fn(async () => state), save };
}

function radio(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll("label")].find((node) => node.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`Missing ${label}`);
  return found.querySelector("input")!;
}

describe("Complete from Hevy link control (Ticket 317)", () => {
  it("stays hidden while unavailable or not connected", async () => {
    for (const state of [linkState({ available: false }), linkState({ connected: false })]) {
      await act(() => root.render(<SourceLinkSettings behaviorId={BEHAVIOR} coordinator={coordinator(state)} />));
      await act(async () => undefined);
      expect(container.textContent).toBe("");
    }
  });

  it("leads with routines, is off by default, and saves the chosen routine", async () => {
    const control = coordinator(linkState());
    await act(() => root.render(<SourceLinkSettings behaviorId={BEHAVIOR} coordinator={control} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Complete from Hevy"));
    const labels = [...container.querySelectorAll("fieldset > label")].map((node) => node.textContent?.trim().split(" ·")[0]);
    expect(labels).toEqual(["Off", "Chosen routines", "Any workout"]);
    expect(radio("Off").checked).toBe(true);
    await act(() => radio("Chosen routines").click());
    expect(container.textContent).toContain("Push · linked to Chest day");
    const push = [...container.querySelectorAll<HTMLInputElement>("[data-source-link-routines] input")][1];
    expect(push.disabled).toBe(true);
    await act(() => radio("Legs").click());
    await act(async () => { [...container.querySelectorAll("button")].find((node) => node.textContent === "Save Hevy link")!.click(); });
    expect(control.save).toHaveBeenCalledWith({ behaviorId: BEHAVIOR, mode: "routines", selectorKeys: [LEGS] });
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy link saved."));
  });

  it("says a routine workout also counts for the any-workout Behavior and refuses a second one", async () => {
    await act(() => root.render(<SourceLinkSettings behaviorId={BEHAVIOR}
      coordinator={coordinator(linkState({ mode: "routines", selectorKeys: [LEGS], anyHolder: { behaviorId: "gym", title: "Gym" } }))} />));
    await vi.waitFor(() => expect(container.querySelector("[data-any-holder-note]")?.textContent).toContain("also counts for Gym"));
    expect(radio("Any workout").disabled).toBe(true);
    expect(container.textContent).toContain("linked to Gym. One Behavior can use any workout.");
  });

  it("names the Behavior holding a refused routine or any-workout link", async () => {
    const save = vi.fn(async () => ({ saved: false as const, reason: "selector_already_linked" as const, holder: { behaviorId: "other", title: "Chest day" } }));
    await act(() => root.render(<SourceLinkSettings behaviorId={BEHAVIOR} coordinator={coordinator(linkState({ mode: "routines", selectorKeys: [LEGS] }), save as never)} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Save Hevy link"));
    await act(async () => { [...container.querySelectorAll("button")].find((node) => node.textContent === "Save Hevy link")!.click(); });
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("already linked to Chest day"));
  });

  it("counts stale routines only when the list is complete, and shows the fenced state", async () => {
    await act(() => root.render(<SourceLinkSettings behaviorId={BEHAVIOR}
      coordinator={coordinator(linkState({ mode: "routines", selectorKeys: [LEGS, "c".repeat(64)], staleLinkedCount: 1, fenced: true }))} />));
    await vi.waitFor(() => expect(container.querySelector("[data-stale-routines]")?.textContent).toBe("1 linked routine is no longer in Hevy."));
    expect(container.textContent).toContain("saved for a different Hevy account");
    await act(() => root.render(<SourceLinkSettings behaviorId={`${BEHAVIOR.slice(0, -1)}2`}
      coordinator={coordinator(linkState({ mode: "routines", selectorKeys: [LEGS], staleLinkedCount: null, routinesComplete: false }))} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Showing the first 200 routines"));
    expect(container.querySelector("[data-stale-routines]")).toBeNull();
  });
});

const occurrenceBase: TimelineOccurrenceView = {
  id: "o1", behaviorId: BEHAVIOR, title: "Leg day", scheduledFor: "2026-11-10T23:00:00Z", scheduledTimeLabel: "6:00 PM",
  localDate: "2026-11-10", status: "completed", statusMarkedAt: "2026-11-10T23:50:00Z", statusLabel: "Completed", statusDetail: "",
  expandedStatusActionLabel: "Change status", visualTone: "completed", isVisibleInNeedsDecision: false,
  canShowDecisionActionsWhenUnresolved: false, showDecisionActions: false, showCollapsedStatusLabel: true, description: "",
  categoryName: "Fitness", scheduleSummary: "Daily", note: "",
  timeTracking: { state: "idle", sessions: [], totalSeconds: 0, runningSessionId: null, runningStartedAt: null } as unknown as TimelineOccurrenceView["timeTracking"],
  canStartTimeTracking: false,
};
const noop = async () => ({ status: "idle" as const, message: "" });

function renderRow(occurrence: TimelineOccurrenceView) {
  return act(() => root.render(<RefreshProvider onRefresh={() => undefined}><OccurrenceRow occurrence={occurrence} statusAction={noop as never} noteAction={noop as never}
    startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never} /></RefreshProvider>));
}

describe("Count an unlinked workout (Ticket 324)", () => {
  const unresolved: TimelineOccurrenceView = { ...occurrenceBase, status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved",
    visualTone: "default", showCollapsedStatusLabel: false };
  const countable = [{ activityRef: `hevy/${"1".repeat(64)}`, startAt: "2026-11-10T23:05:00Z", endAt: "2026-11-10T23:25:00Z", label: "Count the 6:05 PM Hevy workout" }];

  function renderCountRow(occurrence: TimelineOccurrenceView, onRefresh = vi.fn(), workouts = countable) {
    return act(() => root.render(<RefreshProvider onRefresh={onRefresh}><OccurrenceRow occurrence={occurrence} statusAction={noop as never} noteAction={noop as never}
      startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never} countableWorkouts={workouts} /></RefreshProvider>));
  }

  it("offers the workout on an Unresolved row and posts only its reference", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ counted: true, attached: true, reason: "attached" }), { status: 200 }));
    const onRefresh = vi.fn();
    await renderCountRow(unresolved, onRefresh);
    const button = [...container.querySelectorAll("[data-count-workouts] button")].find((node) => node.textContent === "Count the 6:05 PM Hevy workout");
    expect(button).toBeDefined();
    await act(async () => { (button as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/connectors/completions/count", expect.objectContaining({ method: "POST",
      body: JSON.stringify({ occurrenceId: "o1", source: "hevy", activityRef: countable[0].activityRef }) }));
  });

  it("explains a refusal and keeps the row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ counted: false, reason: "matched_by_link" }), { status: 200 }));
    await renderCountRow(unresolved);
    await act(async () => { (container.querySelector("[data-count-workouts] button") as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("A link already uses this workout."));
  });

  it("shows nothing when no workout is countable (a marked row gets none)", async () => {
    await renderCountRow(unresolved, vi.fn(), []);
    expect(container.querySelector("[data-count-workouts]")).toBeNull();
  });
});

describe("Timeline connector label (Tickets 317 and 319)", () => {
  const workout = { startAt: "2026-11-10T23:05:00Z", endAt: "2026-11-10T23:50:00Z", label: "6:05 PM–6:50 PM" };
  const evidence = (fromConnector: boolean, workouts = [workout]): TimelineSourceEvidence => ({ source: "hevy", sourceLabel: "Hevy", fromConnector, workouts });

  it("shows From Hevy and the workout time for a connector completion", async () => {
    await renderRow({ ...occurrenceBase, sourceEvidence: evidence(true) });
    expect(container.querySelector("[data-source-completion]")?.textContent?.trim()).toBe("From Hevy");
    expect(container.querySelector("[data-source-workouts]")?.textContent).toContain("Workout in Hevy");
    expect(container.querySelector("[data-source-workouts]")?.textContent).toContain("6:05 PM–6:50 PM");
  });

  it("counts several workouts and lists each one", async () => {
    await renderRow({ ...occurrenceBase, sourceEvidence: evidence(true, [{ ...workout, startAt: "2026-11-10T12:00:00Z", label: "7:00 AM–7:45 AM" }, workout]) });
    expect(container.querySelector("[data-source-completion]")?.textContent?.trim()).toBe("From Hevy · 2 workouts");
    expect(container.querySelectorAll("[data-source-workouts] li")).toHaveLength(2);
  });

  it("shows workouts without the label on a row the user marked, and drops it after a manual change", async () => {
    await renderRow({ ...occurrenceBase, sourceEvidence: evidence(false) });
    expect(container.querySelector("[data-source-completion]")).toBeNull();
    expect(container.querySelector("[data-source-workouts]")).not.toBeNull();
    expect(sourceEvidenceSummary(evidence(true), "not_completed")).toBeNull();
    expect(sourceEvidenceSummary(evidence(true), "completed")).toBe("From Hevy");
  });

  it("derives the label from the latest event and attaches it to every row copy", () => {
    const byId = resolveTimelineSourceEvidence({
      timezone: "America/New_York",
      occurrences: [{ id: "o1", status: "completed" }, { id: "o2", status: "completed" }, { id: "o3", status: "not_completed" }],
      latestEvents: new Map([
        ["o1", { statusSemantics: "system_rule_declared", sourceCaptureMethod: "derived", reasonCode: "connector:hevy" }],
        ["o2", { statusSemantics: "explicit_user_correction", sourceCaptureMethod: "manual_tap", reasonCode: null }],
        ["o3", { statusSemantics: "system_rule_declared", sourceCaptureMethod: "derived", reasonCode: "connector:hevy" }],
      ]),
      matches: [{ occurrenceId: "o2", source: "hevy", state: "active", activityStartAt: workout.startAt, activityEndAt: workout.endAt },
        { occurrenceId: "o2", source: "hevy", state: "removed", activityStartAt: workout.startAt, activityEndAt: workout.endAt }],
    });
    expect(byId.o1).toMatchObject({ fromConnector: true, workouts: [] });
    expect(byId.o2).toMatchObject({ fromConnector: false, workouts: [{ label: "6:05 PM–6:50 PM" }] });
    expect(byId.o3).toBeUndefined();
    const view = attachTimelineSourceEvidence({
      daySections: [{ occurrences: [occurrenceBase], occurrenceGroups: [{ occurrences: [occurrenceBase] }] }],
      needsDecision: { daySections: [] },
    } as never, byId) as unknown as { daySections: Array<{ occurrences: TimelineOccurrenceView[]; occurrenceGroups: Array<{ occurrences: TimelineOccurrenceView[] }> }> };
    expect(view.daySections[0].occurrences[0].sourceEvidence?.fromConnector).toBe(true);
    expect(view.daySections[0].occurrenceGroups[0].occurrences[0].sourceEvidence?.fromConnector).toBe(true);
  });
});

describe("Hevy panel last check (Ticket 317)", () => {
  const connected: ConnectorConnectionView = { accountId: "account-1", provider: "hevy", status: "connected", generation: 1, selectionRevision: 0,
    preferences: { selectedSourceIds: [], hiddenSourceIds: [], visible: true, showAllDay: true } };
  const hevy = (completionStatus?: HevyCoordinator["completionStatus"]): HevyCoordinator => ({
    getConnection: vi.fn(async () => connected), connect: vi.fn(), refreshActivities: vi.fn(), disconnect: vi.fn(), completionStatus,
  } as unknown as HevyCoordinator);

  it("shows the last successful check beside the connection state", async () => {
    await act(() => root.render(<HevyPanel coordinator={hevy(async () => ({ available: true, lastReconciledAt: "2026-11-10T23:05:00Z" }))} localDate="2026-11-10" timezone="America/New_York" />));
    await vi.waitFor(() => expect(container.querySelector("[data-completion-check]")?.textContent).toBe("Last checked for completed Behaviors Nov 10, 6:05 PM."));
  });

  it("says when no check has run, and shows nothing while the feature is off", async () => {
    await act(() => root.render(<HevyPanel coordinator={hevy(async () => ({ available: true, lastReconciledAt: null }))} localDate="2026-11-10" timezone="America/New_York" />));
    await vi.waitFor(() => expect(container.querySelector("[data-completion-check]")?.textContent).toBe("Not checked for completed Behaviors yet."));
    await act(() => root.render(<HevyPanel coordinator={hevy(async () => ({ available: false, lastReconciledAt: null }))} localDate="2026-11-10" timezone="America/New_York" refreshVersion={1} />));
    await act(async () => undefined);
  });
});

describe("Timing statistics (Ticket 318)", () => {
  const match = (occurrenceId: string, offsetMinutes: number, state = "active") => ({
    occurrenceId, state, activityRef: `hevy/${occurrenceId}`, scheduledStartAt: "2026-11-10T23:00:00Z", scheduledEndAt: null,
    activityStartAt: new Date(Date.parse("2026-11-10T23:00:00Z") + offsetMinutes * 60_000).toISOString().replace(".000", ""),
  });

  it("counts Completed Occurrences only, one match each, nearest the scheduled start", () => {
    const summaries = resolveConnectorTimingSummaries({
      occurrences: [
        { id: "a", behaviorId: "b1", status: "completed" },
        { id: "b", behaviorId: "b1", status: "completed" },
        { id: "c", behaviorId: "b1", status: "completed" },
        { id: "d", behaviorId: "b1", status: "not_completed" },
        { id: "e", behaviorId: "b1", status: "completed" },
      ],
      matches: [match("a", 10), match("a", -600), match("b", 40), match("c", 45), match("d", 0), match("e", 0, "removed")],
    });
    expect(summaries.get("b1")).toEqual({ matchedCount: 3, onTimeCount: 1, medianOffsetMinutes: 40, label: "On schedule 1 of 3. Usually 40 min later." });
  });

  it("words earlier, hour-long and exact medians", () => {
    expect(connectorTimingLabel(6, 9, 40)).toBe("On schedule 6 of 9. Usually 40 min later.");
    expect(connectorTimingLabel(2, 4, -75)).toBe("On schedule 2 of 4. Usually 1 h 15 min earlier.");
    expect(connectorTimingLabel(3, 3, 0)).toBe("On schedule 3 of 3. Usually at the scheduled time.");
  });
});
