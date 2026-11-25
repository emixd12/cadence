// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { AdvisorTimelineFrame } from "@/components/advisor/AdvisorTimelineFrame";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { advisorBubbleTeaser, advisorLineItem, behaviorEditHref, parseBehaviorEditTarget, proposalShortLine, type AdvisorClient } from "@/lib/ui/advisor";
import type { AdvisorTipLink } from "@cadence/core/types/advisor-tips";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import {
  ADVISOR_FIXTURE_CHECK_IN,
  ADVISOR_FIXTURE_LINK_TIP,
  ADVISOR_FIXTURE_PROPOSAL,
  ADVISOR_FIXTURE_QUESTION_TIP,
  ADVISOR_FIXTURE_TIP_QUESTION,
  ADVISOR_FIXTURE_TIP,
  ADVISOR_FIXTURE_TRIAL,
  fixtureAdvisorClient,
} from "@/app/design-system/advisor-fixtures";
import { BRIEF_MOVE_FIXTURE_BRIEFING, fixtureBriefMoveClient } from "@/app/design-system/brief-move-fixtures";

// Advisor plan Phase 4 (4E) + November 24, 2026 speech-pill revision on the web and the Mac.

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

async function render(advisor: AdvisorClient | null, brief?: DailyBriefClient, onOpenLink?: (link: AdvisorTipLink) => void) {
  await act(async () => {
    root.render(
      <RefreshProvider onRefresh={refresh}>
        <AdvisorTimelineFrame client={advisor} onOpenLink={onOpenLink} banner={<p>wave banner</p>} fallbackBanner={<p>horse banner</p>}>
          {brief ? <DailyBriefLauncher client={brief} sessionKey="test" /> : null}
          <section data-today><h2>Thursday</h2></section>
        </AdvisorTimelineFrame>
      </RefreshProvider>,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const bubble = () => document.querySelector<HTMLElement>("[data-advisor-bubble]");
const panel = () => document.querySelector<HTMLElement>("[data-advisor-panel]");
const horseButton = () => document.querySelector<HTMLButtonElement>("[data-advisor-window]");
const horseLabel = () => horseButton()?.textContent;
async function click(label: string, scope: ParentNode = document) {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function openAdvisor() {
  const button = horseButton();
  if (!button) throw new Error("No advisor window button");
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("advisor priority order and speech pill teasers", () => {
  const none = { kind: "none" } as const;
  it("puts the unopened brief first, then a question, then the tip", () => {
    const brief = { kind: "ready", key: "a:2026-11-19", openMoves: 2 } as const;
    expect(advisorLineItem({ brief, briefSeen: false, proposal: ADVISOR_FIXTURE_PROPOSAL, tip: ADVISOR_FIXTURE_TIP, tipAnsweredHere: false })?.kind).toBe("brief");
    expect(advisorLineItem({ brief, briefSeen: true, proposal: ADVISOR_FIXTURE_PROPOSAL, tip: ADVISOR_FIXTURE_TIP, tipAnsweredHere: false })?.kind).toBe("proposal");
    expect(advisorLineItem({ brief: none, briefSeen: false, proposal: ADVISOR_FIXTURE_CHECK_IN, tip: ADVISOR_FIXTURE_TIP, tipAnsweredHere: false })?.kind).toBe("check_in");
    expect(advisorLineItem({ brief: none, briefSeen: false, proposal: ADVISOR_FIXTURE_TRIAL, tip: ADVISOR_FIXTURE_TIP, tipAnsweredHere: false })?.kind).toBe("tip");
    expect(advisorLineItem({ brief: none, briefSeen: false, proposal: null, tip: null, tipAnsweredHere: false })).toBeNull();
  });

  it("drops a tip answered Not now on another device, keeps one answered here", () => {
    const tip = { ...ADVISOR_FIXTURE_TIP, reaction: "not_now" as const };
    expect(advisorLineItem({ brief: none, briefSeen: false, proposal: null, tip, tipAnsweredHere: false })).toBeNull();
    expect(advisorLineItem({ brief: none, briefSeen: false, proposal: null, tip, tipAnsweredHere: true })?.kind).toBe("tip");
  });

  it("shortens a schedule question and builds concise speech pill teasers", () => {
    expect(proposalShortLine(ADVISOR_FIXTURE_PROPOSAL)).toBe("Try Gym at 6:30 PM every Tuesday?");
    expect(advisorBubbleTeaser({ kind: "brief", openMoves: 2 })).toBe("2 moves suggested for today");
    expect(advisorBubbleTeaser({ kind: "brief", openMoves: 0 })).toBe("Today’s brief is ready");
    expect(advisorBubbleTeaser({ kind: "proposal", view: ADVISOR_FIXTURE_PROPOSAL })).toBe("Try Gym at 6:30 PM every Tuesday?");
    expect(advisorBubbleTeaser({ kind: "check_in", view: ADVISOR_FIXTURE_CHECK_IN })).toBe("Keep Gym at 6:30 PM every Tuesday?");
    expect(advisorBubbleTeaser({ kind: "tip", tip: ADVISOR_FIXTURE_TIP })).toBe(
      "Morning journal was done 11 days running, then missed Tuesday and Wednesday",
    );
  });
});

describe("advisor speech pill and panel", () => {
  it("shows nothing of the advisor without a client (a Mac with no account)", async () => {
    await render(null);
    expect(container.textContent).toContain("horse banner");
    expect(horseButton()).toBeNull();
    expect(bubble()).toBeNull();
  });

  it("gives the avatar the resolver's state: waiting with a tip, attending with the panel open", async () => {
    await render(fixtureAdvisorClient());
    const state = () => document.querySelector<HTMLElement>("[data-advisor-window] [data-advisor-avatar]")?.dataset.advisorAvatar;
    expect(state()).toBe("state.waiting");
    await openAdvisor();
    expect(state()).toBe("state.attending");
  });

  it("shows a speech pill instead of the Advisor label when a tip waits, and saves Helpful in the panel", async () => {
    const client = fixtureAdvisorClient();
    const react = vi.spyOn(client, "react");
    await render(client);
    expect(container.textContent).toContain("wave banner");
    expect(bubble()?.dataset.advisorBubble).toBe("tip");
    expect(bubble()?.textContent).toContain("Morning journal was done 11 days running, then missed Tuesday and Wednesday");
    expect(horseLabel()).not.toContain("Advisor");
    // No inline line under today's date.
    expect(document.querySelector("[data-advisor-line]")).toBeNull();

    await openAdvisor();
    expect(bubble()).toBeNull();
    expect(panel()?.textContent).toContain(ADVISOR_FIXTURE_TIP.text);
    await click("Why this?", panel()!);
    expect(panel()?.querySelector("[data-advisor-card]")?.textContent).toContain(ADVISOR_FIXTURE_TIP.research.claim);
    await click("Helpful", panel()!);
    expect(react).toHaveBeenCalledWith(ADVISOR_FIXTURE_TIP.id, "helpful");
    expect(panel()?.querySelector("p.italic")?.textContent).toBe("Saved as helpful.");

    await click("Close", panel()!);
    expect(bubble()).toBeNull();
    expect(horseLabel()).toBe("Advisor");
  });

  it("asks for the next tip on focus even when today's tip is unanswered", async () => {
    const client = fixtureAdvisorClient();
    const nextTip = vi.spyOn(client, "nextTip");
    await render(client);
    expect(nextTip).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(nextTip).toHaveBeenCalledTimes(2);
    expect(bubble()?.dataset.advisorBubble).toBe("tip");
  });

  it("opens the panel with the full tip, the trial and a Past tips drill-down, and closes it", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_TRIAL }));
    await openAdvisor();
    expect(panel()).not.toBeNull();
    const text = panel()!.textContent ?? "";
    expect(text).toContain("Today’s tip");
    expect(text).toContain("Don’t suggest this again");
    expect(text).toContain("Trying for two weeks");
    expect(text).toContain("Read at 9:00 PM every day");
    expect(text).toContain("See past tips (2)");
    expect(text).not.toContain("Saved as helpful.");
    // The speech pill hides while the panel is open.
    expect(bubble()).toBeNull();

    // Open the Past tips drill-down, verify focus moves to Back, expand a research card, and return with Escape and Back.
    await click("See past tips (2)", panel()!);
    const past = panel()!.querySelector<HTMLElement>("[data-advisor-past-tips]");
    expect(past).not.toBeNull();
    expect(document.activeElement).toBe(panel()!.querySelector("[data-advisor-past-tips-back]"));
    expect(past!.textContent).toContain("Past tips");
    expect(past!.textContent).toContain("Tips shown in the last 7 days.");
    expect(past!.textContent).toContain("Saved as helpful.");
    const firstPast = past!.querySelector<HTMLElement>("[data-advisor-past-tip]");
    expect(firstPast).not.toBeNull();
    await click("Why this?", firstPast!);
    expect(firstPast!.querySelector("[data-advisor-card]")).not.toBeNull();

    // Pressing Escape in Past tips returns to the main panel and restores focus to See past tips.
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()!.querySelector("[data-advisor-past-tips]")).toBeNull();
    expect(document.activeElement).toBe(panel()!.querySelector("[data-advisor-past-tips-open]"));

    // Returning via ← Back also restores focus to See past tips.
    await click("See past tips (2)", panel()!);
    expect(document.activeElement).toBe(panel()!.querySelector("[data-advisor-past-tips-back]"));
    await click("← Back", panel()!);
    expect(panel()!.querySelector("[data-advisor-past-tips]")).toBeNull();
    expect(document.activeElement).toBe(panel()!.querySelector("[data-advisor-past-tips-open]"));
    expect(panel()!.textContent).toContain("Today’s tip");

    await click("Close", panel()!);
    expect(panel()).toBeNull();
  });

  it("shows Past tips even without a tip today and follows a past tip's action link", async () => {
    const opened = vi.fn<(link: AdvisorTipLink) => void>();
    await render(fixtureAdvisorClient({ tip: null, recent: [ADVISOR_FIXTURE_LINK_TIP] }), undefined, opened);
    expect(bubble()).toBeNull();
    expect(horseLabel()).toBe("Advisor");
    await openAdvisor();
    expect(panel()!.textContent).toContain("See past tips (1)");
    await click("See past tips (1)", panel()!);
    await click("Set a length", panel()!);
    expect(opened).toHaveBeenCalledWith(ADVISOR_FIXTURE_LINK_TIP.link);
    expect(panel()).toBeNull();
  });

  it("announces a check-in in the speech pill and answers it in the panel", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_CHECK_IN }));
    expect(bubble()?.dataset.advisorBubble).toBe("check_in");
    expect(bubble()?.textContent).toContain("Keep Gym at 6:30 PM every Tuesday?");
    await openAdvisor();
    await click("Go back", panel()!);
    expect(panel()?.querySelector("p.italic")?.textContent).toBe("Gym is back at 7:00 AM every Tuesday.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a refused answer as one red Not changed line", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_PROPOSAL, refuseWith: "held_today" }));
    expect(bubble()?.dataset.advisorBubble).toBe("proposal");
    expect(bubble()?.textContent).toContain("Try Gym at 6:30 PM every Tuesday?");
    await openAdvisor();
    await click("Try for two weeks", panel()!);
    const alert = panel()!.querySelector("[data-alert-kind=write_refused]");
    expect(alert?.textContent).toBe("Not changed. It would move one of today’s items, so it waits until tomorrow.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the brief in the panel and names its open moves in the speech pill until it is opened", async () => {
    const brief: DailyBriefClient = {
      preferences: async () => ({ accountRef: "acct", available: true, enabled: true, revision: 1, localDate: "2026-11-18", timezone: "America/New_York", includeCalendar: false }),
      updatePreferences: async () => { throw new Error("unused"); },
      requestBrief: async () => ({ state: "ready", briefing: BRIEF_MOVE_FIXTURE_BRIEFING }),
      moves: fixtureBriefMoveClient(),
    };
    await render(fixtureAdvisorClient(), brief);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const open = BRIEF_MOVE_FIXTURE_BRIEFING.moves!.lines.filter((item) => item.status === "proposed").length;
    expect(bubble()?.dataset.advisorBubble).toBe("brief");
    expect(bubble()?.textContent).toContain(`${open} moves suggested for today`);
    // The brief is not on the Timeline itself.
    expect(document.querySelector("[data-daily-brief-state]")).toBeNull();
    await openAdvisor();
    const embedded = panel()!.querySelector("[data-daily-brief-embedded]");
    expect(embedded?.textContent).toContain(BRIEF_MOVE_FIXTURE_BRIEFING.text);
    await click("Close", panel()!);
    // Opened once, the speech pill moves on to the tip.
    expect(bubble()?.dataset.advisorBubble).toBe("tip");
    expect(bubble()?.textContent).toContain("Morning journal was done 11 days running, then missed Tuesday and Wednesday");
  });
});

describe("tips with one-tap changes", () => {
  it("shows the tip's question in the speech pill, answers Change for good in the panel, then Undo", async () => {
    const client = fixtureAdvisorClient({ tip: ADVISOR_FIXTURE_QUESTION_TIP, proposal: ADVISOR_FIXTURE_TIP_QUESTION });
    const answer = vi.spyOn(client, "answerProposal");
    await render(client);
    expect(bubble()?.dataset.advisorBubble).toBe("proposal");
    expect(bubble()?.textContent).toContain("Set Gym to 6:30 PM every day?");
    await openAdvisor();
    const question = panel()!.querySelector("[data-advisor-tip-question]");
    expect(question?.textContent).toContain(ADVISOR_FIXTURE_TIP_QUESTION.tip!.text);
    // The tip is shown once, inside its question, not again as today's tip.
    expect(panel()!.textContent).not.toContain("Today’s tip");
    await click("Change for good", panel()!);
    expect(answer).toHaveBeenLastCalledWith(ADVISOR_FIXTURE_TIP_QUESTION.proposalId, "for_good");
    expect(panel()!.querySelector("p.italic")?.textContent).toBe("Gym is at 6:30 PM every Tuesday from now on.");
    await click("Undo", panel()!);
    expect(answer).toHaveBeenLastCalledWith(ADVISOR_FIXTURE_TIP_QUESTION.proposalId, "undo");
    expect(panel()!.querySelector("p.italic")?.textContent).toBe("Gym is back at 7:00 AM.");
    expect(Array.from(panel()!.querySelectorAll("button")).some((button) => button.textContent === "Undo")).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("puts a tip's link first in the panel and follows it, closing the panel", async () => {
    const opened = vi.fn<(link: AdvisorTipLink) => void>();
    await render(fixtureAdvisorClient({ tip: ADVISOR_FIXTURE_LINK_TIP }), undefined, opened);
    await openAdvisor();
    const tipBlock = panel()!.querySelector<HTMLElement>("[data-advisor-tip]")!;
    const first = tipBlock.querySelector("button");
    expect(first?.textContent).toBe("Set a length");
    await click("Set a length", panel()!);
    expect(opened).toHaveBeenCalledWith(ADVISOR_FIXTURE_LINK_TIP.link);
    expect(panel()).toBeNull();
  });

  it("builds and reads the Behaviors editor address", () => {
    const id = "0d000000-0000-4000-8000-000000000010";
    expect(behaviorEditHref({ behaviorId: id, field: "length" })).toBe(`/behaviors?edit=${id}&field=length`);
    expect(parseBehaviorEditTarget(id, "length")).toEqual({ behaviorId: id, field: "length" });
    expect(parseBehaviorEditTarget(id, "nonsense")).toEqual({ behaviorId: id, field: null });
    expect(parseBehaviorEditTarget("not-an-id", "time")).toBeNull();
  });
});
