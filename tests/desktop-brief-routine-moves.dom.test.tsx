// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import type { BriefMoveAnswerRequest, BriefMoveAnswerResponse, BriefMoveLine, BriefMoveLineResult, BriefMoves } from "@cadence/core/types/brief-moves";
import { BriefMoveLines } from "@/components/briefing/BriefMoveLines";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import type { BriefMoveClient } from "@/lib/ui/daily-brief-moves";
import { DesktopDailyBriefClient } from "../apps/desktop/src/daily-brief";

// Sub-behaviors on the Mac: a Daily Brief routine line goes through the Mac's hosted
// client like any other line. The server reads `routine` from its stored line, so the
// request carries only the proposal. Every applied answer asks account sync to pull
// the moved steps and redraws the local Timeline.

const TZ = "America/New_York";
const DAY = "2026-11-18";
const at = (time: string) => new Date(`${DAY}T${time}:00-05:00`).toISOString();
const ORIGIN = "https://cadence.invalid";

function routineLine(proposalId: string, title: string, steps: readonly string[], from: string, to: string): BriefMoveLine {
  return {
    proposalId, occurrenceId: steps[0]!, behaviorId: `beh-${steps[0]}`, behaviorRevision: "2026-11-01T00:00:00Z",
    title, localDate: DAY, timezone: TZ, expectedRevision: `rev-${proposalId}`,
    from: { startAt: at(from), endAt: at(from) }, to: { startAt: at(to), endAt: at(to) },
    length: { minutes: 30, source: "fallback", assumed: true }, reasonCode: "calendar_overlap",
    reason: "Your 9:00 design review runs until 10:30.", anchor: null,
    otherTimes: [at("13:00"), at("15:30")], travel: "not_needed", late: false, offerNeverMove: false,
    status: "proposed", moveId: null,
    routine: { parentBehaviorId: `parent-${proposalId}`, title, occurrenceIds: steps },
  };
}

const SKIN = routineLine("skin", "Skin routine", ["occ-cerave", "occ-facewash", "occ-retinol"], "09:00", "11:30");
const MOBILITY = routineLine("mobility", "Morning mobility", ["occ-hips", "occ-ankles"], "09:30", "12:00");
const MOVES: BriefMoves = {
  version: "1", localDate: DAY, timezone: TZ, runId: "run-mac", lines: [SKIN, MOBILITY], conflicts: [],
  acceptAll: true, undoAllBatchId: null, calendar: "current",
};
const context = { calendarBusy: [{ startAt: at("09:00"), endAt: at("10:30") }], travelTimes: "signed" };

/** The hosted answer route, as far as these lines need it. */
function hostedAnswer(body: BriefMoveAnswerRequest): BriefMoveAnswerResponse {
  const byId = new Map(MOVES.lines.map((line) => [line.proposalId, line]));
  const applied = (line: BriefMoveLine, status: BriefMoveLine["status"], startAt: string | null): BriefMoveLineResult => ({
    proposalId: line.proposalId, outcome: "applied", refusal: null,
    line: { ...line, status, moveId: startAt ? `move-${line.proposalId}` : null, appliedTo: startAt ? { startAt, endAt: startAt } : null },
    occurrence: { id: line.occurrenceId, effectiveStartAt: startAt, effectiveEndAt: startAt, revision: `rev2-${line.proposalId}`, status: "unresolved" },
    moveId: startAt ? `move-${line.proposalId}` : null,
  });
  const response = (results: BriefMoveLineResult[], batchId: string | null = null): BriefMoveAnswerResponse =>
    ({ kind: body.kind, results, batchId, replayed: false, showFirstMoveLine: false });
  switch (body.kind) {
    case "yes": { const line = byId.get(body.proposalId)!; return response([applied(line, "accepted", line.to.startAt)]); }
    case "other_time": return response([applied(byId.get(body.proposalId)!, "other_time", body.startAt)]);
    case "undo": return response([applied(byId.get(body.proposalId)!, "undone", null)]);
    case "accept_all": return response(body.lines.map(({ proposalId }) => applied(byId.get(proposalId)!, "accepted", byId.get(proposalId)!.to.startAt)), "batch-1");
    case "undo_all": return response(MOVES.lines.map((line) => applied(line, "undone", null)));
    default: return response([]);
  }
}

let container: HTMLDivElement;
let root: Root;
let onRefresh: ReturnType<typeof vi.fn<() => void>>;
let onAccountWrite: ReturnType<typeof vi.fn<() => void>>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let inFlight = 0;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onRefresh = vi.fn<() => void>();
  onAccountWrite = vi.fn<() => void>();
  inFlight = 0;
  fetcher = vi.fn<typeof fetch>(async (url, init) => String(url).endsWith("/recheck")
    ? Response.json({ replaced: [] })
    : Response.json(hostedAnswer(JSON.parse(String(init!.body)) as BriefMoveAnswerRequest)));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const timelineActions: OccurrenceMoveActions = {
  suggest: async () => [],
  move: async () => ({ status: "error", message: "unused" }),
  revert: async () => ({ status: "error", message: "unused" }),
  reason: async (input) => ({ status: "saved", reason: input.reason }),
  keep: async () => ({ status: "kept" as const }),
};

/** The Mac's own move client, counting answers in flight so the test waits for them. */
function macMoves(): BriefMoveClient {
  const mac = new DesktopDailyBriefClient(ORIGIN, async () => "synthetic-session", null, fetcher, onAccountWrite);
  return { ...mac.moves, answer: (request, signal) => {
    inFlight += 1;
    return mac.moves.answer(request, signal).finally(() => { inFlight -= 1; });
  } };
}

async function settle() {
  do { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); } while (inFlight > 0);
}
async function render() {
  await act(() => root.render(<RefreshProvider onRefresh={onRefresh}>
    <OccurrenceMovesProvider actions={timelineActions} timezone={TZ} todayLocalDate={DAY} hasMovedBefore>
      <BriefMoveLines moves={structuredClone(MOVES)} client={macMoves()} planningContext={() => context} />
    </OccurrenceMovesProvider>
  </RefreshProvider>));
  await settle();
}
const line = (id: string) => container.querySelector<HTMLElement>(`[data-brief-move-line="${id}"]`)!;
function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!found) throw new Error(`No button ${label}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLButtonElement) {
  await act(async () => { target.click(); });
  await settle();
}
/** The answer bodies the Mac sent to the hosted route, with its bearer session. */
function sentAnswers(): BriefMoveAnswerRequest[] {
  return fetcher.mock.calls.filter(([url]) => !String(url).endsWith("/recheck")).map(([url, init]) => {
    expect(url).toBe(`${ORIGIN}/api/advisor/brief/answer`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-session" } });
    return JSON.parse(String(init!.body)) as BriefMoveAnswerRequest;
  });
}

describe("Daily Brief routine moves on the Mac", () => {
  it("shows one line per routine, titled with the routine, with no length correction for the summed length", async () => {
    await render();
    expect(line("skin").querySelector("[data-brief-move-head]")!.textContent).toMatch(/^Skin routine 9:00 AM → 11:30 AM:/);
    expect(line("skin").textContent).not.toContain("set length");
    expect(line("skin").querySelector("[data-brief-move-actions]")!.textContent).toBe("Yes · No · Other time");
    expect(container.querySelector("[data-brief-accept-all]")!.textContent).toBe("Accept all");
    // Opening re-checks both open lines; nothing moves until an answer.
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ proposalIds: ["skin", "mobility"] });
    expect(sentAnswers()).toEqual([]);
    expect(onAccountWrite).not.toHaveBeenCalled();
  });

  it("Yes moves the routine through the hosted route, syncs, redraws the Timeline, and Undo puts it back", async () => {
    await render();
    await click(button(line("skin"), "Yes"));
    expect(sentAnswers()).toEqual([expect.objectContaining({ kind: "yes", proposalId: "skin", expectedRevision: "rev-skin", context })]);
    expect(sentAnswers()[0]).not.toHaveProperty("routine");
    expect(onAccountWrite).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalled();
    expect(line("skin").textContent).toContain("Moved to 11:30 AM for today. Undo");
    expect(document.querySelector("[data-move-toast]")!.textContent).toContain("Skin routine moved to 11:30 AM for today.");

    await click(button(line("skin"), "Undo"));
    expect(sentAnswers()[1]).toMatchObject({ kind: "undo", proposalId: "skin", expectedRevision: "rev2-skin" });
    expect(onAccountWrite).toHaveBeenCalledTimes(2);
    expect(line("skin")).toBeNull();
  });

  it("Other time moves the routine to the picked start", async () => {
    await render();
    await click(button(line("mobility"), "Other time"));
    await click(button(line("mobility"), "3:30 PM"));
    expect(sentAnswers()).toEqual([expect.objectContaining({ kind: "other_time", proposalId: "mobility", startAt: at("15:30"), context })]);
    expect(onAccountWrite).toHaveBeenCalledOnce();
    expect(line("mobility").textContent).toContain("Moved to 3:30 PM for today. Undo");
    expect(document.querySelector("[data-move-toast]")!.textContent).toContain("Morning mobility moved to 3:30 PM for today.");
  });

  it("Accept all moves both routines in one batch, and Undo all reverses it", async () => {
    await render();
    await click(button(container, "Accept all"));
    expect(sentAnswers()[0]).toMatchObject({ kind: "accept_all", context, lines: [
      { proposalId: "skin", expectedRevision: "rev-skin" }, { proposalId: "mobility", expectedRevision: "rev-mobility" },
    ] });
    expect(onAccountWrite).toHaveBeenCalledOnce();
    expect(line("skin").getAttribute("data-brief-move-status")).toBe("accepted");
    expect(line("mobility").getAttribute("data-brief-move-status")).toBe("accepted");

    await click(button(container, "Undo all"));
    expect(sentAnswers()[1]).toMatchObject({ kind: "undo_all", batchId: "batch-1" });
    expect(onAccountWrite).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-brief-undo-all]")).toBeNull();
    expect(onRefresh.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
