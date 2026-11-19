// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import type { BriefMoves } from "@cadence/core/types/brief-moves";
import { BriefMoveLines } from "@/components/briefing/BriefMoveLines";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { FIRST_MOVE_LINE, OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";
import type { BriefMoveClient } from "@/lib/ui/daily-brief-moves";
import { BRIEF_MOVE_FIXTURE, BRIEF_MOVE_FIXTURE_BRIEFING, BRIEF_MOVE_FIXTURE_LINES, fixtureBriefMoveClient } from "@/app/design-system/brief-move-fixtures";

// Advisor plan Phase 3B: the brief's move lines on the web.

let container: HTMLDivElement;
let root: Root;
let refresh: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  refresh = vi.fn<() => void>();
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const context = { calendarBusy: [{ startAt: "2026-11-18T14:00:00.000Z", endAt: "2026-11-18T15:30:00.000Z" }], travelTimes: "signed" };

const timelineActions: OccurrenceMoveActions = {
  suggest: async () => [],
  move: async () => ({ status: "error", message: "unused" }),
  revert: async () => ({ status: "error", message: "unused" }),
  reason: async (input) => ({ status: "saved", reason: input.reason }),
  keep: vi.fn(async () => ({ status: "kept" as const })),
};

async function render(client: BriefMoveClient, moves: BriefMoves = structuredClone(BRIEF_MOVE_FIXTURE), withTimeline = true) {
  const lines = <BriefMoveLines moves={moves} client={client} planningContext={() => context} />;
  await act(() => root.render(<RefreshProvider onRefresh={refresh}>
    {withTimeline
      ? <OccurrenceMovesProvider actions={timelineActions} timezone={moves.timezone} todayLocalDate={moves.localDate} hasMovedBefore={false}>{lines}</OccurrenceMovesProvider>
      : lines}
  </RefreshProvider>));
}

function line(proposalId: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-brief-move-line="${proposalId}"]`)!;
}
function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!found) throw new Error(`No button ${label}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLButtonElement) {
  await act(async () => { target.click(); });
}

describe("move lines", () => {
  it("reads like text: title, times, reason, then Yes · No · Other time, with late and assumed-length extras", async () => {
    await render(fixtureBriefMoveClient());
    const walk = line("walk");
    expect(walk.querySelector("[data-brief-move-head]")!.textContent).toMatch(/^Walk 9:00 AM → 11:30 AM: Your 9:00 design review runs until 10:30/);
    expect(walk.querySelector("[data-brief-move-actions]")!.textContent).toBe("Yes · No · Other time");
    expect(line("gym").textContent).toContain("30 min is a guess · set length");
    expect(container.textContent).not.toContain("travel not checked");
    expect(line("vitamins").querySelector("[data-brief-move-actions]")!.textContent).toBe("Yes · No · Other time · Already did it · Stop suggesting moves for Vitamins");
    expect(container.querySelector("[data-brief-accept-all]")!.textContent).toBe("Accept all");
    expect(container.querySelector('[data-brief-conflict="conflict-stretch"]')!.textContent).toContain("on top of Piano practice");
    // Text links only: no filled or outlined buttons.
    expect(container.querySelector(".product-action")).toBeNull();
  });

  it("Yes sends the screen's calendar and travel, redraws the Timeline and opens the move drawer with Undo", async () => {
    const client = fixtureBriefMoveClient();
    const answer = vi.spyOn(client, "answer");
    await render(client);
    await click(button(line("walk"), "Yes"));
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ kind: "yes", proposalId: "walk", expectedRevision: BRIEF_MOVE_FIXTURE_LINES[0]!.expectedRevision, context }));
    expect(refresh).toHaveBeenCalled();
    expect(line("walk").textContent).toContain("Moved to 11:30 AM for today. Undo");
    expect(line("walk").querySelector("[data-brief-explainer]")).toBeNull();
    const drawer = document.querySelector("[data-move-toast]")!;
    expect(drawer.textContent).toContain("Walk moved to 11:30 AM for today.");
    expect(drawer.textContent).toContain(FIRST_MOVE_LINE);
    // Undo in the drawer goes through the brief's own answer, so it counts as a No.
    await click(button(drawer, "Undo"));
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "undo", proposalId: "walk" }));
    // Undo counts as a No, so the line leaves the brief.
    expect(line("walk")).toBeNull();
  });

  it("shows a declined line at full strength, saying where the item stays", async () => {
    await render(fixtureBriefMoveClient());
    await click(button(line("vitamins"), "No"));
    expect(line("vitamins").className).not.toContain("opacity");
    expect(line("vitamins").querySelector("p")!.textContent).toBe("Vitamins 8:00 AM → 12:15 PM: 8:00 has passed; lunch is the next quiet moment.");
    expect(line("vitamins").querySelector("[data-brief-move-actions]")!.textContent).toBe("Staying at 8:00 AM. Stop suggesting moves for Vitamins");
    expect(line("vitamins").querySelector("[data-brief-outcome]")!.className).toContain("italic");
    expect(button(line("vitamins"), "Stop suggesting moves for Vitamins").parentElement!.className).toContain("not-italic");
    expect(line("vitamins").querySelector("[data-brief-explainer]")).toBeNull();
    await click(button(line("vitamins"), "Stop suggesting moves for Vitamins"));
    expect(line("vitamins").querySelector("[data-brief-move-actions]")!.textContent).toBe("Staying at 8:00 AM. The brief won’t suggest moving Vitamins again; you can change this in its settings.");
  });

  it("drops a line answered No from the brief when there is nothing more to choose", async () => {
    await render(fixtureBriefMoveClient());
    await click(button(line("walk"), "No"));
    expect(line("walk")).toBeNull();
    expect(line("gym")).not.toBeNull();
  });

  it("after a reload, names the applied time the server saved, not the suggestion", async () => {
    const moves = structuredClone(BRIEF_MOVE_FIXTURE);
    const walk = moves.lines.find((entry) => entry.proposalId === "walk")!;
    Object.assign(walk, { status: "other_time", moveId: "move-walk", appliedTo: { startAt: "2026-11-18T23:25:00.000Z", endAt: "2026-11-18T23:55:00.000Z" } });
    await render(fixtureBriefMoveClient(), moves);
    expect(line("walk").querySelector("[data-brief-outcome]")!.textContent).toContain("Moved to 6:25 PM for today.");
  });

  it("keeps answers when the same brief is shown again after Close or a Timeline remount", async () => {
    const client = fixtureBriefMoveClient();
    const answer = vi.spyOn(client, "answer");
    const moves = structuredClone(BRIEF_MOVE_FIXTURE);
    await render(client, moves);
    await click(button(line("walk"), "Yes"));
    await click(button(line("vitamins"), "No"));
    await act(() => root.render(null));
    await render(client, moves);
    expect(line("walk").textContent).toContain("Moved to 11:30 AM for today.");
    expect(line("vitamins").textContent).toContain("Staying at 8:00 AM.");
    expect(answer).toHaveBeenCalledTimes(2);
    // A different brief object (a Refresh) starts unanswered.
    await act(() => root.render(null));
    await render(client);
    expect(button(line("walk"), "Yes")).toBeTruthy();
  });

  it("shows a refused Yes in the alert style with free times to pick", async () => {
    const client = fixtureBriefMoveClient({ refuse: ["gym"] });
    const answer = vi.spyOn(client, "answer");
    await render(client);
    await click(button(line("gym"), "Yes"));
    const alert = line("gym").querySelector("[data-alert-kind='write_refused']")!;
    expect(alert.querySelector("svg")).toBeNull();
    expect(alert.querySelector("p")!.textContent).toBe("Not changed. 5:30 PM is taken now: you moved Piano practice there after this brief was written.");
    expect(alert.textContent).toContain("5:30 PM is taken now: you moved Piano practice there after this brief was written.");
    await click(button(alert, "4:00 PM"));
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "other_time", proposalId: "gym", startAt: "2026-11-18T21:00:00.000Z" }));
    expect(line("gym").textContent).toContain("Moved to 4:00 PM for today.");
  });

  it("re-checks open lines when the brief opens, and shows a stale one already re-planned", async () => {
    const client = fixtureBriefMoveClient({ stale: ["gym"] });
    const recheck = vi.spyOn(client, "recheck");
    await render(client);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(recheck).toHaveBeenCalledWith({ localDate: "2026-11-18", context, proposalIds: ["walk", "gym", "vitamins"] }, expect.any(AbortSignal));
    expect(line("gym")).toBeNull();
    expect(line("gym-rechecked").textContent).toContain("12:30 PM → 6:30 PM");
    expect(line("gym-rechecked").textContent).toContain("5:30 PM is taken now, so 6:30 PM instead.");
    expect(line("walk").textContent).toContain("9:00 AM → 11:30 AM");
  });

  it("drops a line the re-check says no longer fits, and keeps the brief when the re-check fails", async () => {
    const client = fixtureBriefMoveClient();
    vi.spyOn(client, "recheck").mockResolvedValueOnce({ replaced: [{ proposalId: "walk", line: null }] });
    await render(client);
    expect(line("walk")).toBeNull();
    await act(() => root.unmount());
    root = createRoot(container);
    vi.spyOn(client, "recheck").mockRejectedValueOnce(new DailyBriefRequestError("offline"));
    await render(client);
    expect(line("walk")).not.toBeNull();
  });

  it("Other time lists free times, a time picker and Re-plan", async () => {
    const client = fixtureBriefMoveClient();
    const replan = vi.spyOn(client, "replan");
    await render(client);
    await click(button(line("walk"), "Other time"));
    const panel = line("walk").querySelector("[data-brief-other-time]")!;
    expect(panel.textContent).toContain("Free today: 1:00 PM · 3:30 PM · 7:00 PM");
    expect(panel.querySelector("input[type=time]")).not.toBeNull();
    await click(button(panel, "Re-plan"));
    expect(replan).toHaveBeenCalledWith({ proposalId: "walk", context });
    expect(line("walk-replanned").textContent).toContain("9:00 AM → 2:00 PM");
  });

  it("corrects an assumed length, then re-plans the line", async () => {
    const client = fixtureBriefMoveClient();
    const length = vi.spyOn(client, "length");
    const replan = vi.spyOn(client, "replan");
    await render(client);
    await click(button(line("gym"), "set length"));
    const input = line("gym").querySelector<HTMLInputElement>("[data-brief-length] input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "45");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button(line("gym"), "Save"));
    expect(length).toHaveBeenCalledWith({ behaviorId: "beh-gym", minutes: 45, expectedBehaviorRevision: "2026-11-01T00:00:00Z" });
    expect(replan).toHaveBeenCalled();
  });

  it("Accept all answers every open line, and Undo all reverses the batch", async () => {
    const client = fixtureBriefMoveClient({ refuse: ["gym"] });
    const answer = vi.spyOn(client, "answer");
    await render(client);
    await click(button(container, "Accept all"));
    expect(container.querySelector("[data-brief-explainer]")?.textContent).toContain("Undo all puts them back");
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ kind: "accept_all", context, lines: expect.arrayContaining([expect.objectContaining({ proposalId: "walk" })]) }));
    expect(line("walk").dataset.briefMoveStatus).toBe("accepted");
    expect(line("gym").dataset.briefMoveStatus).toBe("proposed");
    expect(container.textContent).toContain("One item could not be moved");
    await click(button(container, "Undo all"));
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "undo_all", batchId: "batch-bench" }));
    expect(line("walk")).toBeNull();
    expect(container.querySelector("[data-brief-explainer]")).toBeNull();
  });

  it("Already did it marks Completed; a failed request says nothing changed", async () => {
    const client = fixtureBriefMoveClient();
    await render(client);
    await click(button(line("vitamins"), "Already did it"));
    // The fixture answers after a timer; wait for the line instead of racing it.
    await vi.waitFor(() => expect(line("vitamins").textContent).toContain("Marked Completed."));
    vi.spyOn(client, "answer").mockRejectedValueOnce(new DailyBriefRequestError("offline"));
    await click(button(line("walk"), "Yes"));
    expect(line("walk").textContent).toContain("Not changed. You appear to be offline.");
  });

  it("keeps a schedule-edit collision through the Timeline's own action", async () => {
    await render(fixtureBriefMoveClient());
    await click(button(container.querySelector('[data-brief-conflict="conflict-stretch"]')!, "Keep it here"));
    expect(timelineActions.keep).toHaveBeenCalledWith({ conflictId: "conflict-stretch" });
    expect(container.querySelector('[data-brief-conflict="conflict-stretch"]')).toBeNull();
  });

  it("says when the calendar is stale", async () => {
    await render(fixtureBriefMoveClient(), { ...BRIEF_MOVE_FIXTURE, calendar: "stale" }, false);
    expect(container.querySelector("[data-alert-kind='data_stale']")!.textContent).toContain("Calendar not current");
  });
});

describe("bubble", () => {
  it("shows the opening, then the move lines, then Refresh, with no read-only wording", async () => {
    await act(() => root.render(<RefreshProvider onRefresh={refresh}>
      <DailyBriefBubble state="ready" briefing={{ ...BRIEF_MOVE_FIXTURE_BRIEFING, moves: structuredClone(BRIEF_MOVE_FIXTURE) }} onDismiss={() => undefined}
        moves={{ client: fixtureBriefMoveClient(), planningContext: () => context }}
        refresh={{ onRefresh: () => undefined, pending: false, available: true, error: null }} />
    </RefreshProvider>));
    const text = container.textContent!;
    expect(text.indexOf("A full morning")).toBeLessThan(text.indexOf("Walk"));
    expect(container.querySelector("[data-brief-refresh]")!.textContent).toBe("Refresh");
    expect(text).not.toMatch(/read-only|Suggestions only/i);
  });

  it("shows Cadence's notices in the alert style, without repeating a stale calendar the lines already show", async () => {
    const briefing = { ...BRIEF_MOVE_FIXTURE_BRIEFING, moves: { ...BRIEF_MOVE_FIXTURE, calendar: "stale" as const },
      notices: [{ kind: "calendar_stale" as const, text: "Your calendar did not load." }, { kind: "budget_reached" as const, text: "The written brief returns December 1." }] };
    await act(() => root.render(<RefreshProvider onRefresh={refresh}>
      <DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined}
        moves={{ client: fixtureBriefMoveClient(), planningContext: () => context }} />
    </RefreshProvider>));
    expect(container.querySelector("[data-alert-kind='budget_reached']")!.textContent).toContain("The written brief returns December 1.");
    expect(container.querySelectorAll("[data-alert-kind='data_stale']")).toHaveLength(1);
    expect(container.textContent).not.toContain("Your calendar did not load.");
  });

  it("hides move lines from a client that cannot answer them", async () => {
    await act(() => root.render(<RefreshProvider onRefresh={refresh}>
      <DailyBriefBubble state="ready" briefing={BRIEF_MOVE_FIXTURE_BRIEFING} onDismiss={() => undefined} />
    </RefreshProvider>));
    expect(container.querySelector("[data-brief-moves]")).toBeNull();
    expect(container.querySelector("[data-brief-refresh]")).toBeNull();
  });
});

