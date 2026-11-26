// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARK_DETAIL_PROMPTS, type MarkDetailPromptSettings } from "@cadence/core/resolvers/status.resolver";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";
import { RefreshProvider } from "@cadence/ui/runtime";
import {
  OccurrenceMarkDetailsProvider,
  useOccurrenceMarkDetailParts,
  type JustMarked,
  type OccurrenceMarkDetailActions,
} from "@/components/timeline/OccurrenceMarkDetails";
import { BriefAlongsideQuestion } from "@/components/briefing/BriefAlongsideQuestion";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import type { BriefAlongsideClient } from "@/lib/ui/daily-brief-alongside";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";
import type { DailyBriefing } from "@cadence/core/types/daily-brief";

// Ticket 360 (D33): the Timeline row's alongside line and the Daily Brief's question line.

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

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
}
function button(name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find((element) => element.textContent === name);
  if (!match) throw new Error(`No ${name} button in: ${host.textContent}`);
  return match;
}
async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
  await act(async () => { await Promise.resolve(); });
}

const TZ = "America/New_York";
const SET_AT = "2026-11-25T14:00:00Z"; // 9:00 AM in New York
const ON_TIME = "2026-11-25T14:05:00Z";
const LATE = "2026-11-25T18:00:00Z";
const ALWAYS: MarkDetailPromptSettings = { ...MARK_DETAIL_PROMPTS, alongside: { share: 1 } };

function occurrence(extra: Partial<TimelineOccurrenceView> = {}): TimelineOccurrenceView {
  return {
    id: "occ-helmet", behaviorId: "behavior-helmet", title: "Red light helmet", scheduledFor: SET_AT, scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact", localDate: "2026-11-25", status: "completed", statusMarkedAt: ON_TIME, statusLabel: "Completed", statusDetail: "",
    expandedStatusActionLabel: "Change status", visualTone: "completed", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: false, showCollapsedStatusLabel: true,
    description: "", categoryName: null, scheduleSummary: "Daily", note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: false,
    alongside: { source: "guess" }, alongsideQuestion: true,
    ...extra,
  } as TimelineOccurrenceView;
}

function Line({ view, justMarked }: Readonly<{ view: TimelineOccurrenceView; justMarked: JustMarked | null }>) {
  const parts = useOccurrenceMarkDetailParts({ occurrence: view, justMarked, toneClass: "" });
  return <div data-row>{parts.inline}{parts.below}</div>;
}

function actions(overrides: Partial<OccurrenceMarkDetailActions> = {}): OccurrenceMarkDetailActions {
  return {
    doneAt: vi.fn(async () => ({ status: "saved" as const })),
    notDoneReason: vi.fn(async () => ({ status: "saved" as const })),
    alongside: vi.fn(async () => ({ status: "saved" as const })),
    ...overrides,
  };
}

function row(view: TimelineOccurrenceView, markActions: OccurrenceMarkDetailActions, options: Readonly<{ at?: string; prompts?: MarkDetailPromptSettings; status?: JustMarked["status"] }> = {}) {
  return (
    <OccurrenceMarkDetailsProvider actions={markActions} timezone={TZ} prompts={options.prompts ?? ALWAYS}>
      <Line view={view} justMarked={{ status: options.status ?? "completed", at: options.at ?? ON_TIME }} />
    </OccurrenceMarkDetailsProvider>
  );
}

describe("Timeline row: Done alongside other things?", () => {
  it("shows after an on-time Completed mark while the question is open", async () => {
    await render(row(occurrence(), actions()));
    const line = host.querySelector('[data-mark-detail="alongside"]');
    expect(line?.textContent).toBe("Done alongside other things? Yes · No");
    expect(host.querySelector('[data-done-at]')).toBeNull();
  });

  it("Yes writes true for the Behavior and says it is saved", async () => {
    const markActions = actions();
    await render(row(occurrence(), markActions));
    await click(button("Yes"));
    expect(markActions.alongside).toHaveBeenCalledWith({ occurrenceId: "occ-helmet", behaviorId: "behavior-helmet", alongside: true });
    expect(host.querySelector('[data-mark-detail="saved"]')?.textContent).toBe("Saved: it can be done alongside other things.");
  });

  it("No writes false and says the item needs its own time", async () => {
    const markActions = actions();
    await render(row(occurrence(), markActions));
    await click(button("No"));
    expect(markActions.alongside).toHaveBeenCalledWith({ occurrenceId: "occ-helmet", behaviorId: "behavior-helmet", alongside: false });
    expect(host.querySelector('[data-mark-detail="saved"]')?.textContent).toBe("Saved: it needs its own time.");
  });

  it("shows the server's words when the question was already answered elsewhere (audit fix 7)", async () => {
    const outcome = "Already answered: it needs its own time. Change it in the Behavior.";
    await render(row(occurrence(), actions({ alongside: vi.fn(async () => ({ status: "saved" as const, outcome })) })));
    await click(button("Yes"));
    expect(host.querySelector('[data-mark-detail="saved"]')?.textContent).toBe(outcome);
  });

  it("shows a refusal in the row's own words", async () => {
    await render(row(occurrence(), actions({ alongside: vi.fn(async () => ({ status: "refused" as const, message: "This Behavior changed just now. Try again." })) })));
    await click(button("Yes"));
    expect(host.querySelector('[data-mark-detail="refused"]')?.textContent).toBe("Not changed. This Behavior changed just now. Try again.");
  });

  it("Done at keeps priority: a late mark shows only the Done at line", async () => {
    await render(row(occurrence(), actions(), { at: LATE }));
    expect(host.querySelector('[data-mark-detail="done-at"]')).not.toBeNull();
    expect(host.querySelector('[data-mark-detail="alongside"]')).toBeNull();
    expect(host.querySelectorAll("[data-mark-detail]")).toHaveLength(1);
  });

  it("is absent without the question, without the action, after Not Completed, and outside its share", async () => {
    const { alongsideQuestion: _question, ...closed } = occurrence();
    await render(row(closed as TimelineOccurrenceView, actions()));
    expect(host.querySelector("[data-mark-detail]")).toBeNull();
    const withoutAction = actions();
    delete (withoutAction as { alongside?: unknown }).alongside;
    await render(row(occurrence(), withoutAction));
    expect(host.querySelector("[data-mark-detail]")).toBeNull();
    await render(row(occurrence({ status: "not_completed" }), actions(), { status: "not_completed" }));
    expect(host.querySelector('[data-mark-detail="alongside"]')).toBeNull();
    await render(row(occurrence(), actions(), { prompts: { ...MARK_DETAIL_PROMPTS, alongside: { share: 0 } } }));
    expect(host.querySelector("[data-mark-detail]")).toBeNull();
  });
});

describe("Daily Brief: the alongside question line", () => {
  // A fresh object per test: the line remembers answers per brief question for the page session.
  let question = { behaviorId: "11111111-1111-4111-8111-111111111111", title: "Red light helmet" };
  beforeEach(() => { question = { ...question }; });
  const client = (answer: BriefAlongsideClient["answer"]): BriefAlongsideClient => ({ answer });
  const wrap = (node: React.ReactNode, onRefresh = vi.fn()) => <RefreshProvider onRefresh={onRefresh}>{node}</RefreshProvider>;

  it("asks with Yes and No, and saves Yes", async () => {
    const answer = vi.fn(async () => ({ behaviorId: question.behaviorId, alongside: true, changed: true }));
    const onRefresh = vi.fn();
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />, onRefresh));
    expect(host.querySelector("[data-brief-alongside-question]")?.textContent).toBe("Can Red light helmet be done alongside other things?Yes · No");
    expect(host.querySelector("input, textarea")).toBeNull();
    await click(button("Yes"));
    expect(answer).toHaveBeenCalledWith({ behaviorId: question.behaviorId, alongside: true });
    expect(host.querySelector("[data-brief-outcome]")?.textContent).toBe("Saved: it can be done alongside other things.");
    expect(host.querySelector("[data-brief-alongside-actions]")).toBeNull();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("says the question was already answered elsewhere, with the stored answer (audit fix 7)", async () => {
    const answer = vi.fn(async () => ({ behaviorId: question.behaviorId, alongside: false, changed: false, alreadyAnswered: true }));
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />));
    await click(button("Yes"));
    expect(host.querySelector("[data-brief-outcome]")?.textContent).toBe("Already answered: it needs its own time. Change it in the Behavior.");
  });

  it("saves No", async () => {
    const answer = vi.fn(async () => ({ behaviorId: question.behaviorId, alongside: false, changed: true }));
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />));
    await click(button("No"));
    expect(answer).toHaveBeenCalledWith({ behaviorId: question.behaviorId, alongside: false });
    expect(host.querySelector("[data-brief-outcome]")?.textContent).toBe("Saved: it needs its own time.");
  });

  it("remembers an answer for the same brief after a remount", async () => {
    const answer = vi.fn(async () => ({ behaviorId: question.behaviorId, alongside: false, changed: true }));
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />));
    await click(button("No"));
    await act(() => root.unmount());
    root = createRoot(host);
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />));
    expect(host.querySelector("[data-brief-outcome]")?.textContent).toBe("Saved: it needs its own time.");
  });

  it("keeps Yes and No after a refusal and names it", async () => {
    const answer = vi.fn(async () => { throw new DailyBriefRequestError("proposal_not_found"); });
    await render(wrap(<BriefAlongsideQuestion question={question} client={client(answer)} />));
    await click(button("No"));
    expect(host.textContent).toContain("This Behavior is not in your account anymore.");
    expect(host.querySelector("[data-brief-alongside-actions]")).not.toBeNull();
  });

  const briefing: DailyBriefing = {
    text: "Gym at 6 PM.", localDate: "2026-11-25", timezone: TZ, generatedAt: "2026-11-25T12:00:00Z", expiresAt: "2026-11-26T05:00:00Z",
    coverage: "complete", warnings: [],
  };

  it("the bubble shows the line only with a question and a client", async () => {
    const answer = vi.fn();
    await render(wrap(<DailyBriefBubble state="ready" briefing={{ ...briefing, alongsideQuestion: question }} onDismiss={() => undefined} alongside={client(answer)} />));
    expect(host.querySelector("[data-brief-alongside-question]")).not.toBeNull();
    await render(wrap(<DailyBriefBubble state="ready" briefing={{ ...briefing, alongsideQuestion: question }} onDismiss={() => undefined} />));
    expect(host.querySelector("[data-brief-alongside-question]")).toBeNull();
    await render(wrap(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined} alongside={client(answer)} />));
    expect(host.querySelector("[data-brief-alongside-question]")).toBeNull();
  });
});
