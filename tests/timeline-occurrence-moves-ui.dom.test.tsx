// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { canSelfMoveOccurrence } from "@cadence/core/resolvers/move.resolver";
import type { NormalizedExternalEvent, NormalizedTimedExternalEvent } from "@cadence/core/types/day-progress";
import type { TimelineOccurrenceView, TimelineView } from "@cadence/core/types/timeline";
import { MoveConflictNotices } from "@/components/timeline/MoveConflictNotices";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import {
  calendarBusyFromEvents,
  FIRST_MOVE_LINE,
  MoveCalendarEventsContext,
  OccurrenceMovesProvider,
  type MoveConfirmationStyle,
  type OccurrenceMoveActions,
} from "@/components/timeline/OccurrenceMoves";

// Advisor plan, Phase 2C: the web's own "Move for today", Undo, reasons and notices.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const TZ = "America/New_York";
const TODAY = "2026-11-16";
const REV = "2026-11-16T12:00:00.000Z";
const NEW_REV = "2026-11-16T14:00:00.000Z";

const gym: TimelineOccurrenceView = {
  id: "o1", behaviorId: "b1", title: "Gym", scheduledFor: "2026-11-16T14:00:00Z", scheduledTimeLabel: "9:00 AM",
  scheduleKind: "exact", revision: REV,
  localDate: TODAY, status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
  expandedStatusActionLabel: "Change status", visualTone: "default", isVisibleInNeedsDecision: false,
  canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false, description: "",
  categoryName: "Fitness", scheduleSummary: "Daily", note: "",
  timeTracking: { recordedSeconds: 0, runningStartedAt: null },
  canStartTimeTracking: true,
};
const movedGym: TimelineOccurrenceView = {
  ...gym, scheduledFor: "2026-11-16T15:00:00Z", scheduledTimeLabel: "10:00 AM", movedFromLabel: "9:00 AM", revision: NEW_REV,
};
const noop = async () => ({ status: "idle" as const, message: "" });

type MockActions = { [K in keyof OccurrenceMoveActions]: Mock<OccurrenceMoveActions[K]> };

function actions(overrides: Partial<MockActions> = {}): MockActions {
  return {
    move: vi.fn<OccurrenceMoveActions["move"]>(async (input) => ({
      status: "moved" as const, occurrenceId: input.occurrenceId, moveId: "m1",
      effectiveStartAt: "2026-11-16T15:00:00Z", effectiveEndAt: null, revision: NEW_REV,
    })),
    revert: vi.fn<OccurrenceMoveActions["revert"]>(async (input) => ({
      status: "undone" as const, occurrenceId: input.occurrenceId, moveId: "m2",
      effectiveStartAt: "2026-11-16T14:00:00Z", effectiveEndAt: null, revision: "2026-11-16T14:05:00.000Z",
    })),
    reason: vi.fn<OccurrenceMoveActions["reason"]>(async (input) => ({ status: "saved" as const, reason: input.reason })),
    suggest: vi.fn<OccurrenceMoveActions["suggest"]>(async () => ["2026-11-16T15:00:00Z", "2026-11-16T16:30:00Z"]),
    keep: vi.fn<OccurrenceMoveActions["keep"]>(async () => ({ status: "kept" as const })),
    ...overrides,
  };
}

function row(occurrence: TimelineOccurrenceView) {
  return <OccurrenceRow occurrence={occurrence} statusAction={noop as never} noteAction={noop as never}
    startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never} />;
}

function render(occurrence: TimelineOccurrenceView, moveActions: OccurrenceMoveActions | null, options: Readonly<{
  hasMovedBefore?: boolean; events?: readonly NormalizedExternalEvent[]; onRefresh?: () => void; extra?: React.ReactNode;
  confirmation?: MoveConfirmationStyle;
}> = {}) {
  const content = <MoveCalendarEventsContext.Provider value={options.events ?? []}>{options.extra}{row(occurrence)}</MoveCalendarEventsContext.Provider>;
  return act(() => root.render(<RefreshProvider onRefresh={options.onRefresh ?? (() => undefined)}>
    {moveActions ? <OccurrenceMovesProvider actions={moveActions} timezone={TZ} todayLocalDate={TODAY} hasMovedBefore={options.hasMovedBefore ?? true} confirmation={options.confirmation}>
      {content}
    </OccurrenceMovesProvider> : content}
  </RefreshProvider>));
}

function button(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button ${text}: ${container.textContent}`);
  return found as HTMLButtonElement;
}

describe("Move for today menu", () => {
  it("is offered only on today's Unresolved, exact-time rows with a revision", () => {
    expect(canSelfMoveOccurrence(gym, TODAY)).toBe(true);
    expect(canSelfMoveOccurrence({ ...gym, status: "completed" }, TODAY)).toBe(false);
    expect(canSelfMoveOccurrence({ ...gym, localDate: "2026-11-17" }, TODAY)).toBe(false);
    expect(canSelfMoveOccurrence({ ...gym, scheduleKind: "range" }, TODAY)).toBe(false);
    expect(canSelfMoveOccurrence({ ...gym, revision: undefined }, TODAY)).toBe(false);
  });

  it("is absent without the web provider (the Mac reads moves only)", async () => {
    await render(movedGym, null);
    expect(container.querySelector("[data-move-menu]")).toBeNull();
    expect(container.querySelector("[data-moved-from]")?.textContent).toBe("Moved from 9:00 AM");
    expect(container.querySelector("[data-move-undo]")).toBeNull();
  });

  it("lists free times first and moves at once on a tap, with the calendar's busy times", async () => {
    const control = actions();
    const busy = { kind: "timed", id: "e1", startAt: "2026-11-16T17:00:00Z", endAt: "2026-11-16T18:00:00Z",
      endUnspecified: false, state: "confirmed", availability: "busy", currentUserResponse: "accepted" } as unknown as NormalizedTimedExternalEvent;
    const free = { ...busy, id: "e2", availability: "free" } as NormalizedTimedExternalEvent;
    await render(gym, control, { events: [busy, free] });
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    expect(control.suggest).toHaveBeenCalledWith({ occurrenceId: "o1", calendarBusy: [{ start: busy.startAt, end: busy.endAt, ref: "e1" }] });
    expect(container.textContent).toContain("Free today: 10:00 AM · 11:30 AM");
    await act(async () => button("10:00 AM").click());
    expect(control.move).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "o1", expectedRevision: REV, startTime: "10:00" }));
    expect(control.move.mock.calls[0]![0].idempotencyKey).toBeTruthy();
    await vi.waitFor(() => expect(document.querySelector("[data-move-toast]")?.textContent).toBe("Gym moved to 10:00 AM for today. UndoWhy? Running late · Conflict · Low energy · Other"));
  });

  it("is the last line of the open row, after the note", async () => {
    await render(gym, actions());
    const details = container.querySelector(".timeline-occurrence-details")!;
    expect(details.lastElementChild?.hasAttribute("data-move-menu")).toBe(true);
  });

  it("moves to a typed Other time", async () => {
    const control = actions();
    await render(gym, control);
    await act(async () => button("Move for today").click());
    const input = container.querySelector<HTMLInputElement>("input[type='time']")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "13:15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Move").click());
    expect(control.move).toHaveBeenCalledWith(expect.objectContaining({ startTime: "13:15" }));
  });
});

describe("Moved row", () => {
  it("reads 'Moved from 9:00 AM · Undo', and Undo reverts with the row's revision", async () => {
    const control = actions();
    await render(movedGym, control);
    expect(container.querySelector("[data-moved-from]")?.textContent).toBe("Moved from 9:00 AM · Undo");
    await act(async () => button("Undo").click());
    expect(control.revert).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "o1", expectedRevision: NEW_REV }));
    await vi.waitFor(() => expect(document.querySelector("[data-move-toast]")?.textContent).toBe("Gym is back at 9:00 AM."));
  });

  it("offers one-tap reasons after a move and stores the first tap", async () => {
    const control = actions();
    await render(gym, control);
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    await act(async () => button("10:00 AM").click());
    // The server redraws the row at its new time.
    await render(movedGym, control);
    expect(document.querySelector("[data-move-reasons]")?.textContent).toBe("Why? Running late · Conflict · Low energy · Other");
    await act(async () => button("Low energy").click());
    expect(control.reason).toHaveBeenCalledWith({ moveId: "m1", reason: "low_energy" });
    await vi.waitFor(() => expect(document.querySelector("[data-move-reasons]")?.textContent).toBe("Reason noted: low energy"));
  });

  it("shows the first-move line once, only for a person who never moved before", async () => {
    const control = actions();
    await render(gym, control, { hasMovedBefore: false });
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    await act(async () => button("10:00 AM").click());
    await render(movedGym, control, { hasMovedBefore: false });
    expect(document.querySelector("[data-first-move]")?.textContent).toBe(FIRST_MOVE_LINE);
    // A second move in the same visit no longer shows it.
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='11:30']")).not.toBeNull());
    await act(async () => button("11:30 AM").click());
    await vi.waitFor(() => expect(document.querySelector("[data-move-toast]")?.textContent).toContain("Gym moved to"));
    expect(document.querySelector("[data-first-move]")).toBeNull();
  });

  it("never shows the first-move line to a person who moved before", async () => {
    const control = actions();
    await render(gym, control, { hasMovedBefore: true });
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    await act(async () => button("10:00 AM").click());
    await render(movedGym, control, { hasMovedBefore: true });
    expect(document.querySelector("[data-move-toast]")).not.toBeNull();
    expect(document.querySelector("[data-first-move]")).toBeNull();
  });

  it("offers nothing to undo on a resolved moved row", async () => {
    await render({ ...movedGym, status: "completed", statusLabel: "Completed", visualTone: "completed", showDecisionActions: false, showCollapsedStatusLabel: true }, actions());
    expect(container.querySelector("[data-moved-from]")?.textContent).toBe("Moved from 9:00 AM");
  });
});

describe("Refusals and other devices", () => {
  it("shows a refusal in the alert style with the free times it carries", async () => {
    const onRefresh = vi.fn();
    const control = actions({
      move: vi.fn<OccurrenceMoveActions["move"]>(async () => ({
        status: "refused" as const, occurrenceId: "o1", reason: "slot_taken", message: "Something else is already at that time.",
        alternatives: ["2026-11-16T16:00:00Z"], revision: REV, currentStartAt: "2026-11-16T14:00:00Z",
      })),
    });
    await render(gym, control, { onRefresh });
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    await act(async () => button("10:00 AM").click());
    const alert = await vi.waitFor(() => container.querySelector("[data-alert-kind='write_refused']")!);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Not changed");
    expect(alert.textContent).toContain("Something else is already at that time.");
    expect(alert.textContent).toContain("Free instead: 11:00 AM");
    expect(alert.querySelector("svg")).toBeNull();
    expect(onRefresh).toHaveBeenCalled();
    await act(async () => button("11:00 AM", alert).click());
    expect(control.move).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: "11:00", expectedRevision: REV }));
  });

  it("says where another device moved the item and offers to move it again", async () => {
    const control = actions({
      move: vi.fn<OccurrenceMoveActions["move"]>(async () => ({
        status: "refused" as const, occurrenceId: "o1", reason: "revision_changed", message: "This changed on another device.",
        alternatives: [], revision: NEW_REV, currentStartAt: "2026-11-16T15:00:00Z",
      })),
    });
    await render(gym, control);
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='11:30']")).not.toBeNull());
    await act(async () => button("11:30 AM").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Gym was just moved to 10:00 AM on another device."));
    await act(async () => button("Move it again").click());
    expect(container.querySelector("[data-alert-kind]")).toBeNull();
    await vi.waitFor(() => expect(control.suggest).toHaveBeenCalledTimes(2));
  });
});

describe("Schedule-edit overlap notice", () => {
  const reading: TimelineOccurrenceView = { ...gym, id: "o2", title: "Reading", scheduledFor: "2026-11-16T15:00:00Z", scheduledTimeLabel: "10:00 AM", revision: REV };
  const timeline = {
    timezone: TZ, todayLocalDate: TODAY,
    daySections: [{ localDate: TODAY, occurrences: [movedGym, reading] }],
  } as unknown as TimelineView;
  const conflicts = [{ id: "c1", occurrenceId: "o1", conflictingOccurrenceId: "o2" }];

  it("asks with Yes / No / Other time, and Yes keeps the move", async () => {
    const control = actions();
    await render(movedGym, control, { extra: <MoveConflictNotices conflicts={conflicts} timeline={timeline} /> });
    const notice = container.querySelector("[data-move-conflict='c1']")!;
    expect(notice.textContent).toBe("Your schedule changed, and Gym at 10:00 AM today now overlaps Reading at 10:00 AM. Keep Gym at 10:00 AM? Yes · No · Other time");
    await act(async () => button("Yes", notice).click());
    expect(control.keep).toHaveBeenCalledWith({ conflictId: "c1" });
    await vi.waitFor(() => expect(container.querySelector("[data-move-conflict]")).toBeNull());
  });

  it("No undoes the move, and Other time opens the row's menu", async () => {
    const control = actions();
    await render(movedGym, control, { extra: <MoveConflictNotices conflicts={conflicts} timeline={timeline} /> });
    await act(async () => button("Other time", container.querySelector("[data-move-conflict='c1']")!).click());
    expect(container.querySelector("details")?.open).toBe(true);
    await vi.waitFor(() => expect(control.suggest).toHaveBeenCalled());
    await render(movedGym, control, { extra: <MoveConflictNotices conflicts={[{ ...conflicts[0]!, id: "c2" }]} timeline={timeline} /> });
    await act(async () => button("No", container.querySelector("[data-move-conflict='c2']")!).click());
    expect(control.revert).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "o1", expectedRevision: NEW_REV }));
  });
});

describe("calendar busy times", () => {
  it("leaves out free, cancelled, declined, open-ended and all-day events", () => {
    const base = { kind: "timed", startAt: "2026-11-16T17:00:00Z", endAt: "2026-11-16T18:00:00Z", endUnspecified: false,
      state: "confirmed", availability: "busy", currentUserResponse: "accepted" };
    const events = [
      { ...base, id: "keep" },
      { ...base, id: "free", availability: "free" },
      { ...base, id: "cancelled", state: "cancelled" },
      { ...base, id: "declined", currentUserResponse: "declined" },
      { ...base, id: "open", endUnspecified: true },
      { id: "allday", kind: "all_day", startLocalDate: TODAY, endLocalDate: "2026-11-17" },
    ] as unknown as NormalizedExternalEvent[];
    expect(calendarBusyFromEvents(events).map((event) => event.ref)).toEqual(["keep"]);
  });
});

describe("Confirmation options", () => {
  async function moveGym(confirmation: MoveConfirmationStyle) {
    const control = actions();
    await render(gym, control, { confirmation });
    await act(async () => button("Move for today").click());
    await vi.waitFor(() => expect(container.querySelector("[data-move-option='10:00']")).not.toBeNull());
    await act(async () => button("10:00 AM").click());
    await render(movedGym, control, { confirmation });
    return control;
  }

  it("row: no pop-up; the row is highlighted, keeps Undo and reasons, and the move is announced", async () => {
    await moveGym("row");
    expect(document.querySelector("[data-move-toast]")).toBeNull();
    expect(container.querySelector("[data-just-moved='true']")).not.toBeNull();
    expect(container.querySelector("[data-move-announcement]")?.textContent).toBe("Gym moved to 10:00 AM for today.");
    expect(container.querySelector("[data-moved-from]")?.textContent).toBe("Moved from 9:00 AM · Undo");
    expect(document.querySelector("[data-move-reasons]")).not.toBeNull();
  });

  it("corner: a small note with from and to times and Undo; reasons stay on the row", async () => {
    const control = await moveGym("corner");
    const note = document.querySelector("[data-move-confirmation='corner']")!;
    expect(note.textContent).toBe("Moved for todayGym · 9:00 AM → 10:00 AMUndo");
    expect(note.querySelector("[data-move-reasons]")).toBeNull();
    expect(container.querySelector("article [data-move-reasons]")).not.toBeNull();
    await act(async () => button("Undo", note).click());
    expect(control.revert).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: NEW_REV }));
  });

  it("drawer: carries the reasons itself and closes on Close", async () => {
    await moveGym("drawer");
    const drawer = document.querySelector("[data-move-confirmation='drawer']")!;
    expect(drawer.querySelector("[data-move-reasons]")).not.toBeNull();
    expect(container.querySelector("article [data-move-reasons]")).toBeNull();
    await act(async () => (drawer.querySelector("button[aria-label='Close']") as HTMLButtonElement).click());
    expect(document.querySelector("[data-move-confirmation]")).toBeNull();
  });

  it("dialog: a modal with reasons, Done and Undo", async () => {
    await moveGym("dialog");
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector("[data-move-reasons]")).not.toBeNull();
    button("Undo", dialog);
    await act(async () => button("Done", dialog).click());
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
