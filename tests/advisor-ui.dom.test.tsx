// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { AdvisorTimelineFrame } from "@/components/advisor/AdvisorTimelineFrame";
import { AdvisorDayLine } from "@/components/advisor/AdvisorParts";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { advisorLineItem, behaviorEditHref, parseBehaviorEditTarget, proposalShortLine, type AdvisorClient } from "@/lib/ui/advisor";
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

// Advisor plan Phase 4 (4E): placement K on the web and the Mac (shared components).

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
          <section data-today><h2>Thursday</h2><AdvisorDayLine /></section>
        </AdvisorTimelineFrame>
      </RefreshProvider>,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const line = () => document.querySelector<HTMLElement>("[data-advisor-line]");
const panel = () => document.querySelector<HTMLElement>("[data-advisor-panel]");
const horseLabel = () => document.querySelector<HTMLElement>("[data-advisor-window]")?.textContent;
async function click(label: string, scope: ParentNode = document) {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("advisor line order", () => {
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

  it("shortens a schedule question for the line", () => {
    expect(proposalShortLine(ADVISOR_FIXTURE_PROPOSAL)).toBe("Try Gym at 6:30 PM every Tuesday?");
  });
});

describe("advisor placement K", () => {
  it("shows nothing of the advisor without a client (a Mac with no account)", async () => {
    await render(null);
    expect(container.textContent).toContain("horse banner");
    expect(document.querySelector("[data-advisor-window]")).toBeNull();
    expect(line()).toBeNull();
  });

  it("gives the avatar the resolver's state: waiting with a tip, attending with the panel open", async () => {
    await render(fixtureAdvisorClient());
    const state = () => document.querySelector<HTMLElement>("[data-advisor-window] [data-advisor-avatar]")?.dataset.advisorAvatar;
    expect(state()).toBe("state.waiting");
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-advisor-window]")!.click(); });
    expect(state()).toBe("state.attending");
  });

  it("shows today's tip under the date and saves Helpful as an italic outcome", async () => {
    const client = fixtureAdvisorClient();
    const react = vi.spyOn(client, "react");
    await render(client);
    expect(container.textContent).toContain("wave banner");
    expect(horseLabel()).toContain("Advisor · 1 new");
    expect(line()?.textContent).toContain(ADVISOR_FIXTURE_TIP.text);
    // "Don't suggest this again" is only in the panel.
    expect(line()?.textContent).not.toContain("Don’t suggest this again");
    await click("Why this?", line()!);
    expect(line()?.querySelector("[data-advisor-card]")?.textContent).toContain(ADVISOR_FIXTURE_TIP.research.claim);
    await click("Helpful", line()!);
    expect(react).toHaveBeenCalledWith(ADVISOR_FIXTURE_TIP.id, "helpful");
    const outcome = line()?.querySelector("p.italic");
    expect(outcome?.textContent).toBe("Saved as helpful.");
    expect(horseLabel()).toBe("Advisor");
  });

  it("asks for the next tip on focus even when today's tip is unanswered", async () => {
    const client = fixtureAdvisorClient();
    const nextTip = vi.spyOn(client, "nextTip");
    await render(client);
    expect(nextTip).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(nextTip).toHaveBeenCalledTimes(2);
    expect(line()?.textContent).toContain(ADVISOR_FIXTURE_TIP.text);
  });

  it("opens the panel with the full tip, the trial and earlier tips, and closes it", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_TRIAL }));
    await click("Advisor · 1 new");
    expect(panel()).not.toBeNull();
    const text = panel()!.textContent ?? "";
    expect(text).toContain("Today’s tip");
    expect(text).toContain("Don’t suggest this again");
    expect(text).toContain("Trying for two weeks");
    expect(text).toContain("Read at 9:00 PM every day");
    expect(text).toContain("Earlier");
    expect(text).toContain("Saved as helpful.");
    // The line under the date steps aside while the panel is open.
    expect(line()).toBeNull();
    await click("Close", panel()!);
    expect(panel()).toBeNull();
  });

  it("answers a check-in on the line and refreshes the Timeline after a schedule change", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_CHECK_IN }));
    expect(line()?.textContent).toContain("Keep Gym at 6:30 PM every Tuesday?");
    await click("Go back", line()!);
    expect(line()?.querySelector("p.italic")?.textContent).toBe("Gym is back at 7:00 AM every Tuesday.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a refused answer as one red Not changed line", async () => {
    await render(fixtureAdvisorClient({ proposal: ADVISOR_FIXTURE_PROPOSAL, refuseWith: "held_today" }));
    expect(line()?.textContent).toContain("Try Gym at 6:30 PM every Tuesday?");
    await click("Answer", line()!);
    await click("Try for two weeks", panel()!);
    const alert = panel()!.querySelector("[data-alert-kind=write_refused]");
    expect(alert?.textContent).toBe("Not changed. It would move one of today’s items, so it waits until tomorrow.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the brief in the panel and names its open moves on the line until it is opened", async () => {
    const brief: DailyBriefClient = {
      preferences: async () => ({ accountRef: "acct", available: true, enabled: true, revision: 1, localDate: "2026-11-18", timezone: "America/New_York", includeCalendar: false }),
      updatePreferences: async () => { throw new Error("unused"); },
      requestBrief: async () => ({ state: "ready", briefing: BRIEF_MOVE_FIXTURE_BRIEFING }),
      moves: fixtureBriefMoveClient(),
    };
    await render(fixtureAdvisorClient(), brief);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const open = BRIEF_MOVE_FIXTURE_BRIEFING.moves!.lines.filter((item) => item.status === "proposed").length;
    expect(line()?.textContent).toContain(`${open} moves suggested for today.`);
    // The brief is not on the Timeline itself.
    expect(document.querySelector("[data-daily-brief-state]")).toBeNull();
    await click("Open", line()!);
    const embedded = panel()!.querySelector("[data-daily-brief-embedded]");
    expect(embedded?.textContent).toContain(BRIEF_MOVE_FIXTURE_BRIEFING.text);
    await click("Close", panel()!);
    // Opened once, the line moves on to the tip.
    expect(line()?.textContent).toContain(ADVISOR_FIXTURE_TIP.text);
  });
});

describe("tips with one-tap changes", () => {
  it("shows the tip's question on the line, answers Change for good in the panel, then Undo", async () => {
    const client = fixtureAdvisorClient({ tip: ADVISOR_FIXTURE_QUESTION_TIP, proposal: ADVISOR_FIXTURE_TIP_QUESTION });
    const answer = vi.spyOn(client, "answerProposal");
    await render(client);
    expect(line()?.textContent).toContain("Set Gym to 6:30 PM every day?");
    await click("Answer", line()!);
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

  it("puts a tip's link first and follows it, closing the panel", async () => {
    const opened = vi.fn<(link: AdvisorTipLink) => void>();
    await render(fixtureAdvisorClient({ tip: ADVISOR_FIXTURE_LINK_TIP }), undefined, opened);
    const first = line()!.querySelector("button");
    expect(first?.textContent).toBe("Set a length");
    await click("Set a length", line()!);
    expect(opened).toHaveBeenCalledWith(ADVISOR_FIXTURE_LINK_TIP.link);
    await click(horseLabel()!.trim());
    await click("Set a length", panel()!);
    expect(opened).toHaveBeenCalledTimes(2);
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
