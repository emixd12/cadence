// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import type { BriefOpportunities, BriefOpportunityAnswerRequest, BriefOpportunityAnswerResponse } from "@cadence/core/types/brief-opportunities";
import { BriefOpportunityLines } from "@/components/briefing/BriefOpportunityLines";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import type { BriefOpportunityClient } from "@/lib/ui/daily-brief-opportunities";
import { BRIEF_MOVE_FIXTURE_BRIEFING, fixtureBriefMoveClient } from "@/app/design-system/brief-move-fixtures";
import { BRIEF_OPPORTUNITY_FIXTURE, BRIEF_OPPORTUNITY_FIXTURE_LINES } from "@/app/design-system/brief-opportunity-fixtures";

// Task 7: the brief's "Add for today" lines on the web. Ways this could fail:
//  - an answer posts the wrong body (no target, no screen context, a reused key);
//  - Yes does not show the added time and Undo, or does not refresh the Timeline;
//  - a refusal hides its free times, or a free time does not post Other time;
//  - re-check on open is skipped, or a closed line stays on screen;
//  - a client without the opportunity transport (older Mac) sees the lines.

let container: HTMLDivElement;
let root: Root;
let refresh: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  refresh = vi.fn<() => void>();
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const context = { calendarBusy: [{ startAt: "2026-11-18T19:00:00.000Z", endAt: "2026-11-18T20:00:00.000Z" }], travelTimes: "signed" };
const [read, climb] = BRIEF_OPPORTUNITY_FIXTURE_LINES;

function client(overrides: Partial<BriefOpportunityClient> = {}): BriefOpportunityClient {
  return {
    answer: vi.fn(async (request: BriefOpportunityAnswerRequest): Promise<BriefOpportunityAnswerResponse> => {
      const line = BRIEF_OPPORTUNITY_FIXTURE_LINES.find((entry) => entry.proposalId === request.proposalId)!;
      const added = request.kind === "yes" || request.kind === "other_time";
      const startAt = request.kind === "other_time" ? request.startAt : line.at.startAt;
      return { target: "opportunity", kind: request.kind, proposalId: line.proposalId, outcome: "applied", replayed: false, refusal: null,
        occurrenceId: added || request.kind === "undo" ? "occ-added" : null,
        line: { ...line, status: added ? (request.kind === "yes" ? "accepted" : "other_time") : request.kind === "undo" ? "undone" : "declined",
          occurrenceId: added ? "occ-added" : null, appliedAt: added ? { startAt, endAt: startAt } : null } };
    }),
    replan: vi.fn(async (request) => ({ line: null, replacedProposalId: request.opportunityProposalId })),
    recheck: vi.fn(async () => ({ replaced: [] })),
    preference: vi.fn(async (input) => ({ behaviorId: input.behaviorId, neverSuggestAdd: input.neverSuggestAdd, updatedAt: null })),
    ...overrides,
  };
}

async function settle() {
  for (let index = 0; index < 3; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function render(answers: BriefOpportunityClient, opportunities: BriefOpportunities = structuredClone(BRIEF_OPPORTUNITY_FIXTURE)) {
  await act(() => root.render(<RefreshProvider onRefresh={refresh}>
    <BriefOpportunityLines opportunities={opportunities} client={answers} planningContext={() => context} />
  </RefreshProvider>));
  await settle();
}

const line = (id: string) => container.querySelector<HTMLElement>(`[data-brief-opportunity-line="${id}"]`);
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
async function click(target: HTMLElement) {
  await act(async () => { target.click(); });
  await settle();
}

describe("BriefOpportunityLines", () => {
  it("shows each line with its free window, travel note and the Don't suggest link when offered", async () => {
    await render(client());
    expect(container.textContent).toContain("Add for today");
    expect(line("read")!.textContent).toContain("Read a chapter");
    expect(line("read")!.textContent).toContain("20 min free, last done 4 days ago.");
    expect(line("read")!.textContent).not.toContain("Travel not checked");
    expect(line("climb")!.textContent).toContain("90 min free, not done yet.");
    expect(line("climb")!.textContent).toContain("Travel not checked.");
    expect(button(line("climb")!, "Don’t suggest adding this")).toBeTruthy();
    expect(button(line("read")!, "Don’t suggest adding this")).toBeUndefined();
  });

  it("re-checks open lines once on open and hides a line that closed", async () => {
    const answers = client({ recheck: vi.fn(async () => ({ replaced: [{ proposalId: "climb", line: null }] })) });
    await render(answers);
    expect(answers.recheck).toHaveBeenCalledTimes(1);
    expect(answers.recheck).toHaveBeenCalledWith({ localDate: "2026-11-18", context, proposalIds: ["read", "climb"] }, expect.any(AbortSignal));
    expect(line("climb")).toBeNull();
  });

  it("Yes posts the screen's context, shows the added time with Undo and refreshes; Undo removes it", async () => {
    const answers = client();
    await render(answers);
    await click(button(line("read")!, "Yes"));
    const yes = vi.mocked(answers.answer).mock.calls[0]![0];
    expect(yes).toMatchObject({ target: "opportunity", kind: "yes", proposalId: "read", context });
    expect(yes.idempotencyKey).toMatch(/.+/);
    expect(line("read")!.textContent).toContain("Added for today at 2:10");
    expect(refresh).toHaveBeenCalledTimes(1);

    await click(button(line("read")!, "Undo"));
    const undo = vi.mocked(answers.answer).mock.calls[1]![0];
    expect(undo).toMatchObject({ target: "opportunity", kind: "undo", proposalId: "read" });
    expect(undo.idempotencyKey).not.toBe(yes.idempotencyKey);
    expect(line("read")!.textContent).toContain("Removed from today.");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shows a refusal with free times, and a free time posts Other time", async () => {
    const applied = client().answer;
    const answers = client({ answer: vi.fn(async (request: BriefOpportunityAnswerRequest) => request.kind === "yes"
      ? { target: "opportunity" as const, kind: "yes" as const, proposalId: "read", outcome: "refused" as const, replayed: false, occurrenceId: null, line: read!,
        refusal: { reason: "slot_taken", message: "2:10 PM is not free now.", alternatives: ["2026-11-18T21:30:00.000Z"] } }
      : applied(request)) });
    await render(answers);
    await click(button(line("read")!, "Yes"));
    expect(line("read")!.textContent).toContain("2:10 PM is not free now.");
    expect(refresh).not.toHaveBeenCalled();
    await click(button(line("read")!, "4:30 PM"));
    expect(vi.mocked(answers.answer).mock.calls[1]![0]).toMatchObject({ kind: "other_time", startAt: "2026-11-18T21:30:00.000Z", context });
    expect(line("read")!.textContent).toContain("Added for today at 4:30");
  });

  it("No keeps the Behavior off today; Don't suggest adding this confirms the switch", async () => {
    const answers = client();
    await render(answers);
    await click(button(line("read")!, "No"));
    expect(vi.mocked(answers.answer).mock.calls[0]![0]).toMatchObject({ kind: "no", proposalId: "read" });
    expect(line("read")!.textContent).toContain("Not adding it today.");
    await click(button(line("climb")!, "Don’t suggest adding this"));
    expect(vi.mocked(answers.answer).mock.calls[1]![0]).toMatchObject({ kind: "never_add", proposalId: "climb" });
    expect(line("climb")!.textContent).toContain("The brief won’t suggest adding Climbing again.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Re-plan with nothing free says so under the line", async () => {
    const answers = client();
    await render(answers);
    await click(button(line("read")!, "Other time"));
    expect(container.querySelector("[data-brief-opportunity-other-time]")).not.toBeNull();
    await click(button(line("read")!, "Re-plan"));
    expect(answers.replan).toHaveBeenCalledWith({ opportunityProposalId: "read", context });
    expect(line("read")!.textContent).toContain("No other time fits today.");
  });
});

describe("DailyBriefBubble with opportunity lines", () => {
  const briefing = { ...BRIEF_MOVE_FIXTURE_BRIEFING, opportunities: BRIEF_OPPORTUNITY_FIXTURE };
  const moves = { client: fixtureBriefMoveClient(), planningContext: () => context };

  it("shows them only for a client with the opportunity transport", async () => {
    await act(() => root.render(<RefreshProvider onRefresh={refresh}>
      <DailyBriefBubble state="ready" briefing={briefing} moves={moves} onDismiss={() => undefined} />
    </RefreshProvider>));
    expect(container.querySelector("[data-brief-opportunities]")).toBeNull();
    await act(() => root.render(<RefreshProvider onRefresh={refresh}>
      <DailyBriefBubble state="ready" briefing={briefing} moves={moves} opportunities={{ client: client(), planningContext: () => context }} onDismiss={() => undefined} />
    </RefreshProvider>));
    await settle();
    expect(container.querySelector("[data-brief-opportunities]")).not.toBeNull();
    expect(climb).toBeDefined();
  });
});
