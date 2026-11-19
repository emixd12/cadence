"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppShell } from "@/components/layout/AppShell";
import { CadencePageBanner } from "@/components/layout/ScreenFrame";
import { Timeline } from "@/components/timeline/Timeline";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import type { OccurrenceFormAction, TimeTrackingFormAction, TimelineOccurrenceInput } from "@/lib/types/timeline";

// Advisor plan 4D, rounds 1 and 1b: where the advisor (the horse) shows its tips.
// Placements on the real app shell and Timeline, synthetic data, nothing is saved.
// One URL reproduces one view: ?preview=advisor-placement&option=a&view=why

export type PlacementOption = "a" | "a2" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "j";
export type PlacementView = "closed" | "open" | "why" | "answered" | "scrolled" | "scrolled-open";

export const PLACEMENT_OPTIONS: readonly Readonly<{ id: PlacementOption; label: string; summary: string }>[] = [
  { id: "a", label: "A · Horse in the menu", summary: "An Advisor line in the main menu, with the horse as its icon. A dot means a new tip." },
  { id: "a2", label: "A2 · Menu horse opens Chat", summary: "The same menu line opens the Advisor page: today’s tip on top, then the chat." },
  { id: "b", label: "B · Banner horse", summary: "The Timeline’s own horse gets a dot. Tapping it opens the tip in the brief’s bubble." },
  { id: "c", label: "C · Corner horse", summary: "A small horse waits in a screen corner on every page. A dot means a new tip." },
  { id: "d", label: "D · Line in the Timeline", summary: "The tip is a quiet line between what is done today and what comes next." },
  { id: "e", label: "E · Window at the top", summary: "Round 1b. The horse looks out of a round window at the top of the page and stays there as you scroll. Tapping it opens the advisor’s panel." },
  { id: "f", label: "F · Top of today", summary: "Round 1b. The tip is the first line of today’s list." },
  { id: "g", label: "G · Under the date", summary: "Round 1b. A short tip sits under today’s date." },
  { id: "h", label: "H · Under its Behavior", summary: "Round 1b. The tip sits under the Behavior it is about, like a reply." },
  { id: "j", label: "J · Banner horse speaks", summary: "Round 1b. The Timeline’s horse shows the tip. Scroll past it and a small window horse waits at the top." },
];

const TIMEZONE = "America/New_York";

const QUIP_SHORT = "Two skipped journal days do not undo 11 in a row. Keep tomorrow’s 8:00 AM.";

const QUIP = "Morning journal was done 11 days running, then not done on Tuesday or Wednesday. In habit research a skipped day or two did not set the habit back. Keep tomorrow’s 8:00 AM as it is.";

// A real, checked source (fixture only; 4A owns the card library).
const CARD = {
  claim: "Missing one chance to do a new habit did not measurably slow how fast it became automatic.",
  source: "Lally et al., 2010. How are habits formed. European Journal of Social Psychology 40(6)",
  url: "https://doi.org/10.1002/ejsp.674",
  kind: "Field study, 96 adults over 12 weeks",
  strength: "Moderate evidence",
  appliesTo: "Anyone building a daily habit.",
  limitation: "Volunteers chose their own habit; most were simple eating, drinking or exercise habits.",
} as const;

// ---------- Timeline fixture: Thursday, November 19, 2026, 3:20 PM in New York ----------

function occurrence(id: string, title: string, at: string, localDate: string, label: string,
  status: TimelineOccurrenceInput["status"] = "unresolved"): TimelineOccurrenceInput {
  return {
    id, behaviorId: `behavior-${id}`, title, scheduledFor: at, scheduledTimeLabel: label, localDate, status,
    statusMarkedAt: { unresolved: null, completed: at, not_completed: at }[status],
    description: "", categoryName: "Bench", scheduleSummary: `Every day at ${label}`, note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: false,
  };
}

const TIMELINE = resolveTimeline({
  timezone: TIMEZONE,
  now: Temporal.Instant.from("2026-11-19T20:20:00Z"),
  futureDays: 0,
  occurrences: [
    occurrence("read-yesterday", "Read", "2026-11-19T02:30:00Z", "2026-11-18", "9:30 PM"),
    occurrence("vitamins", "Vitamins", "2026-11-19T13:00:00Z", "2026-11-19", "8:00 AM", "completed"),
    occurrence("journal", "Morning journal", "2026-11-19T13:00:00Z", "2026-11-19", "8:00 AM", "completed"),
    occurrence("walk", "Walk outside", "2026-11-19T17:30:00Z", "2026-11-19", "12:30 PM", "completed"),
    occurrence("piano", "Piano practice", "2026-11-19T22:30:00Z", "2026-11-19", "5:30 PM"),
    occurrence("gym", "Gym", "2026-11-19T23:30:00Z", "2026-11-19", "6:30 PM"),
    occurrence("read", "Read", "2026-11-20T02:30:00Z", "2026-11-19", "9:30 PM"),
  ],
});

const NO_MOVES: OccurrenceMoveActions = {
  async suggest() { return []; },
  async move(input) { return { status: "moved", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r2" }; },
  async revert(input) { return { status: "undone", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r3" }; },
  async reason(input) { return { status: "saved", reason: input.reason }; },
  async keep() { return { status: "kept" }; },
};

// ---------- The horse ----------

/**
 * The advisor looking out of a round window: the whole head shows, and the neck runs out of the bottom edge.
 * Draft artwork for this round only. `dot` marks an unseen tip.
 */
function HorseMark({ size = 28, dot = false }: Readonly<{ size?: number; dot?: boolean }>) {
  const dotSize = Math.max(8, Math.round(size * 0.22));
  return (
    <span aria-hidden="true" className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span className="absolute inset-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--primary)_9%,var(--background))] ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={size > 72 ? "/brand/cadence-advisor-window-draft.webp" : "/brand/cadence-advisor-window-draft-small.webp"} alt="" className="h-full w-full mix-blend-multiply" />
      </span>
      {dot ? <span className="absolute right-0 top-0 rounded-full bg-primary ring-2 ring-background" style={{ width: dotSize, height: dotSize }} /> : null}
    </span>
  );
}

// ---------- The tip itself (shared by every option) ----------

function TipBody({ view, onView, short = false }: Readonly<{ view: PlacementView; onView: (view: PlacementView) => void; short?: boolean }>) {
  return (
    <div className="text-sm leading-6">
      <p className="break-words text-foreground">{short && view !== "why" ? QUIP_SHORT : QUIP}</p>
      {view === "why" ? (
        <div className="mt-2 border-l border-line pl-3" data-advisor-card>
          <p className="text-foreground">{CARD.claim}</p>
          <p><a href={CARD.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{CARD.source}</a></p>
          <p className="text-xs leading-5 text-muted-readable">{CARD.kind} · {CARD.strength}</p>
          <p className="text-xs leading-5 text-muted-readable">Applies to: {CARD.appliesTo}</p>
          <p className="text-xs leading-5 text-muted-readable">Limitation: {CARD.limitation}</p>
        </div>
      ) : null}
      {view === "answered" ? (
        <p className="mt-1 italic text-foreground">Saved as helpful.</p>
      ) : (
        <p className="mt-1 flex flex-wrap gap-x-1">
          <button type="button" className="underline underline-offset-2" onClick={() => onView(view === "why" ? "open" : "why")}>
            {view === "why" ? "Hide research" : "Why this?"}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="underline underline-offset-2" onClick={() => onView("answered")}>Helpful</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="underline underline-offset-2" onClick={() => onView("closed")}>Not now</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="underline underline-offset-2" onClick={() => onView("closed")}>Don’t suggest this again</button>
        </p>
      )}
      <p className="mt-1 text-xs leading-5 text-muted-readable">Tip 1 of 2 today.</p>
    </div>
  );
}

/** The square bubble the brief already uses, titled Advisor. `pointer` says where the horse is. */
function TipBubble({ view, onView, pointer, className = "" }: Readonly<{
  view: PlacementView; onView: (view: PlacementView) => void;
  pointer: "top-right" | "top-left" | "top-center" | "left" | "bottom-left" | "bottom-right"; className?: string;
}>) {
  const pointerClass = {
    "top-center": "-top-2 left-1/2 -ml-2 border-l border-t",
    "top-right": "-top-2 right-[12%] border-l border-t",
    "top-left": "-top-2 left-6 border-l border-t",
    left: "-left-2 top-5 -rotate-90 border-l border-t",
    "bottom-left": "-bottom-2 left-6 border-r border-b",
    "bottom-right": "-bottom-2 right-6 border-r border-b",
  }[pointer];
  return (
    <section aria-label="Advisor tip" className={`relative z-30 border border-line bg-background p-4 ${className}`} data-advisor-bubble>
      <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-line bg-background ${pointerClass}`} />
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="font-bold">Advisor</p>
        <button type="button" onClick={() => onView("closed")}
          className="-my-3 min-h-11 min-w-11 py-3 text-right text-muted-readable underline underline-offset-2 hover:text-foreground">Close</button>
      </div>
      <TipBody view={view} onView={onView} />
    </section>
  );
}

// ---------- Timeline page parts ----------

function Banner({ dot, onHorse }: Readonly<{ dot: boolean; onHorse?: () => void }>) {
  return (
    <div className="relative w-full overflow-hidden bg-background">
      <div className="aspect-[1423/367] w-full sm:aspect-[2041/239]">
        <picture className="block h-full w-full">
          <source media="(max-width: 639px)" srcSet="/brand/cadence-timeline-horse-lines-dots-mobile-right-18.png" />
          <img src="/brand/cadence-timeline-horse-lines-dots-clear-background.png" alt="" aria-hidden="true" className="block h-full w-full object-fill lg:mt-1" />
        </picture>
      </div>
      {onHorse ? (
        <button type="button" onClick={onHorse} aria-label={dot ? "Open the advisor’s new tip" : "Open the advisor"}
          className="absolute right-[3%] top-0 h-full w-[22%] sm:right-[4%] sm:w-[12%]">
          {dot ? <span className="absolute right-[18%] top-[10%] h-2.5 w-2.5 rounded-full bg-primary sm:right-[30%] sm:top-[4%]" /> : null}
        </button>
      ) : null}
    </div>
  );
}

/** Under the horse, where "Today’s brief" already sits after the brief is closed. */
function ReopenRow({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="relative z-10 -mt-6 ml-auto w-fit text-sm leading-6 text-muted-readable sm:-mt-4">{children}</p>;
}

type InlineTip = Readonly<{ anchor: "row" | "day-heading"; occurrenceId?: string; position: "before" | "after"; content: ReactNode }>;

function findAnchor(inline: InlineTip): Element | null {
  if (inline.anchor === "day-heading") {
    const label = Array.from(document.querySelectorAll("p, span, div"))
      .find((element) => element.childElementCount === 0 && element.textContent?.trim() === "Current day");
    return label?.parentElement ?? null;
  }
  const row = document.querySelector(`[data-occurrence-id="${inline.occurrenceId}"]`);
  return row?.closest("li") ?? row;
}

function TimelineScreen({ statusAction, noteAction, timeAction, beforeTimeline, inline }: Readonly<{
  statusAction: OccurrenceFormAction; noteAction: OccurrenceFormAction; timeAction: TimeTrackingFormAction;
  beforeTimeline?: ReactNode; inline?: InlineTip;
}>) {
  // The Timeline owns its rows, so the bench line is mounted in its own root next to the chosen element.
  const rootRef = useRef<Readonly<{ root: Root; holder: HTMLElement }> | null>(null);
  const placeKey = inline ? `${inline.anchor}:${inline.occurrenceId ?? ""}:${inline.position}` : "";
  const inlineRef = useRef(inline);
  useLayoutEffect(() => { inlineRef.current = inline; });
  useLayoutEffect(() => {
    const current = inlineRef.current;
    if (!placeKey || !current) return;
    const anchor = findAnchor(current);
    if (!anchor?.parentElement) return;
    const holder = document.createElement(anchor.tagName === "LI" ? "li" : "div");
    holder.dataset.advisorInline = "";
    if (current.position === "before") anchor.before(holder); else anchor.after(holder);
    rootRef.current = { root: createRoot(holder), holder };
    return () => {
      const mounted = rootRef.current;
      rootRef.current = null;
      queueMicrotask(() => { mounted?.root.unmount(); mounted?.holder.remove(); });
    };
  }, [placeKey]);
  useLayoutEffect(() => { rootRef.current?.root.render(inline?.content ?? null); });
  return (
    <>
      {beforeTimeline}
      <Timeline timeline={TIMELINE} statusAction={statusAction} noteAction={noteAction}
        startTimeTrackingAction={timeAction} stopTimeTrackingAction={timeAction} resetTimeTrackingAction={timeAction} />
    </>
  );
}

// ---------- Option E: the advisor's panel (Muse-style) ----------

function AdvisorPanel({ view, onView }: Readonly<{ view: PlacementView; onView: (view: PlacementView) => void }>) {
  return (
    <section aria-label="Advisor" className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 pb-8 pt-4 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[26rem] lg:border-l lg:border-line" data-advisor-panel>
      <div className="flex justify-end">
        <button type="button" onClick={() => onView("closed")}
          className="min-h-11 min-w-11 text-right text-sm text-muted-readable underline underline-offset-2 hover:text-foreground">Close</button>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <HorseMark size={128} />
        <h2 className="mt-2 text-xl">Advisor</h2>
        <p className="text-xs leading-5 text-muted-readable">Tips from what you track, with the research behind them.</p>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-xs font-bold text-muted-readable">Today</p>
        <div className="mt-1"><TipBody view={view === "closed" ? "open" : view} onView={onView} /></div>
      </div>
      <div className="mt-6 border-t border-line pt-4 text-sm leading-6">
        <p className="text-xs font-bold text-muted-readable">Trying for two weeks</p>
        <p className="mt-1">Gym at 6:30 PM on Tuesdays</p>
        <p className="text-xs leading-5 text-muted-readable">Day 3 of 14. Ends Tuesday, Dec 8.</p>
      </div>
      <div className="mt-6 grid gap-3 border-t border-line pt-4 text-sm leading-6">
        <p className="text-xs font-bold text-muted-readable">Earlier</p>
        <div>
          <p>Gym moved to 6:30 PM three Tuesdays running. Doing it at one steady time makes it easier to keep.</p>
          <p className="italic">Saved as helpful.</p>
          <p className="text-xs leading-5 text-muted-readable">Tuesday, Nov 17</p>
        </div>
        <div>
          <p>Read was done on 5 of the last 7 nights when it came before 10:00 PM, and on none after.</p>
          <p className="text-xs leading-5 text-muted-readable">Monday, Nov 16</p>
        </div>
      </div>
      <div className="mt-6 border-t border-line pt-4 text-sm">
        <a href="#chat" className="underline underline-offset-2">Chat with the advisor</a>
      </div>
    </section>
  );
}

// ---------- Option A2: the Advisor page with Chat ----------

function AdvisorChatPage({ view, onView }: Readonly<{ view: PlacementView; onView: (view: PlacementView) => void }>) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col px-4 pb-6 pt-8 sm:px-6 lg:min-h-dvh lg:pt-12">
      <div className="flex items-center gap-3">
        <HorseMark size={40} />
        <h1 className="text-2xl">Advisor</h1>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-xs font-bold text-muted-readable">Today’s tip</p>
        <div className="mt-1"><TipBody view={view === "closed" ? "open" : view} onView={(next) => onView(next === "closed" ? "open" : next)} /></div>
      </div>
      <div className="mt-6 grid gap-4 border-t border-line pt-4 text-sm leading-6">
        <p className="text-xs font-bold text-muted-readable">Earlier today</p>
        <p className="justify-self-end text-right">Can I fit Piano practice before Gym?</p>
        <p>Yes. Piano practice is set for 5:30 PM and Gym for 6:30 PM, and your calendar is free between them. 30 minutes of piano ends at 6:00 PM.</p>
      </div>
      <div className="mt-auto flex items-end gap-3 pt-8 text-sm">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Ask the advisor</span>
          <input placeholder="Ask about your Behaviors" className="w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm placeholder:text-muted-readable focus:outline-none" />
        </label>
        <button type="button" className="min-h-11 underline underline-offset-2">Send</button>
      </div>
    </div>
  );
}

// ---------- The bench ----------

const ROUND_1: readonly PlacementOption[] = ["a", "a2", "b", "c", "d"];
const ROUND_1B: readonly PlacementOption[] = ["e", "f", "g", "h", "j"];
const SCROLLED_TOP = 320;

/** Option J: true once the Timeline's banner horse has scrolled out of view. */
function usePastBanner(enabled: boolean, startScrolled: boolean) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => setPast(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    if (startScrolled) window.scrollTo({ top: SCROLLED_TOP });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled, startScrolled]);
  return enabled && past;
}

export function AdvisorPlacementBench({ statusAction, noteAction, timeAction, initialOption, initialView, shot }: Readonly<{
  statusAction: OccurrenceFormAction; noteAction: OccurrenceFormAction; timeAction: TimeTrackingFormAction;
  initialOption: PlacementOption; initialView: PlacementView; shot: boolean;
}>) {
  const [option, setOption] = useState<PlacementOption>(initialOption);
  const [view, setView] = useState<PlacementView>(initialView);
  const open = view !== "closed";
  const unseen = view === "closed";
  const startScrolled = initialView === "scrolled" || initialView === "scrolled-open";
  const pastBanner = usePastBanner(option === "j", startScrolled);

  const navHorse = option === "a" || option === "a2";
  const navLine = (collapsed: boolean) => navHorse ? (
    <button type="button" onClick={() => setView(open ? "closed" : "open")} aria-current={option === "a2" && open ? "page" : undefined}
      className={["group flex h-10 w-full items-center overflow-hidden text-sm", option === "a2" && open ? "bg-timeline-row-hover text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"].join(" ")}>
      <span className="flex h-10 w-16 shrink-0 items-center justify-center"><HorseMark size={28} dot={unseen} /></span>
      {collapsed ? null : <span className="whitespace-nowrap text-sm">Advisor</span>}
    </button>
  ) : null;
  const headerHorse = navHorse ? (
    <button type="button" aria-label="Advisor" onClick={() => setView(open ? "closed" : "open")} className="flex h-16 w-14 items-center justify-center">
      <HorseMark size={34} dot={unseen} />
    </button>
  ) : null;

  const tip = (pointer: Parameters<typeof TipBubble>[0]["pointer"], className?: string) =>
    <TipBubble view={view} onView={setView} pointer={pointer} className={className} />;
  const reopen = (links: ReactNode = <button type="button" className="underline underline-offset-2">Today’s brief</button>) => <ReopenRow>{links}</ReopenRow>;

  let page: ReactNode;
  if (option === "a2" && open) {
    page = <AdvisorChatPage view={view} onView={setView} />;
  } else {
    let banner: ReactNode = <Banner dot={option === "b" && unseen} onHorse={option === "b" || option === "j" ? () => setView(open ? "closed" : "open") : undefined} />;
    let beforeTimeline: ReactNode = reopen();
    let inline: InlineTip | undefined;
    let overlay: ReactNode = null;
    const tipOpen = view === "open" || view === "why" || view === "answered";

    if (option === "b" && open) beforeTimeline = tip("top-right", "ml-auto -mt-8 w-full sm:-mt-6 sm:w-[min(40rem,100%)] mb-6");
    if (option === "d" && open) {
      inline = { anchor: "row", occurrenceId: "walk", position: "after", content: (
        <div className="flex gap-3 border-b border-line py-4 sm:pl-2" data-advisor-line>
          <HorseMark size={32} />
          <div className="min-w-0 flex-1"><TipBody view={view} onView={setView} /></div>
        </div>
      ) };
    }
    if (option === "f" && open) {
      inline = { anchor: "row", occurrenceId: "journal", position: "before", content: (
        <div className="mb-2 flex gap-3 border-b border-line pb-4 pt-1 sm:pl-2" data-advisor-line>
          <HorseMark size={36} />
          <div className="min-w-0 flex-1"><TipBody view={view} onView={setView} /></div>
        </div>
      ) };
    }
    if (option === "g" && open) {
      inline = { anchor: "day-heading", position: "after", content: (
        <div className="flex gap-3 pt-3" data-advisor-line>
          <HorseMark size={28} />
          <div className="min-w-0 flex-1"><TipBody short view={view} onView={setView} /></div>
        </div>
      ) };
    }
    if (option === "h" && open) {
      inline = { anchor: "row", occurrenceId: "journal", position: "after", content: (
        <div className="flex gap-3 py-3 pl-4 sm:pl-[7.25rem]" data-advisor-line>
          <HorseMark size={28} />
          <div className="min-w-0 flex-1"><TipBody view={view} onView={setView} /></div>
        </div>
      ) };
    }
    if (option === "e") {
      banner = (
        <div className="relative">
          <CadencePageBanner />
          <div className="h-10 sm:h-12" />
        </div>
      );
      overlay = (
        <>
          <div className="pointer-events-none fixed left-0 right-0 top-1 z-50 flex justify-center lg:left-64 lg:top-3 lg:z-30">
            <button type="button" onClick={() => setView(open ? "closed" : "open")} aria-label={unseen ? "Open the advisor, 1 new tip" : "Open the advisor"}
              className="pointer-events-auto flex flex-col items-center">
              <span className="rounded-full bg-background p-1 shadow-sm lg:hidden"><HorseMark size={44} dot={unseen} /></span>
              <span className="hidden rounded-full bg-background p-1 shadow-sm lg:block"><HorseMark size={64} dot={unseen} /></span>
              <span className="-mt-1.5 rounded-full bg-background px-2.5 py-0.5 text-xs shadow-sm">Advisor</span>
            </button>
          </div>
          {open ? <AdvisorPanel view={view} onView={setView} /> : null}
        </>
      );
    }
    if (option === "j") {
      if (tipOpen || view === "scrolled" || view === "scrolled-open") beforeTimeline = tip("top-right", "ml-auto -mt-8 w-full sm:-mt-6 sm:w-[min(40rem,100%)] mb-6");
      else beforeTimeline = reopen(<>
        <button type="button" className="underline underline-offset-2">Today’s brief</button>
        <span aria-hidden="true"> · </span>
        <button type="button" onClick={() => setView("open")} className="underline underline-offset-2">Today’s tip</button>
      </>);
      if (pastBanner) {
        const floatingOpen = view === "scrolled-open";
        overlay = (
          <div className="pointer-events-none fixed left-0 right-0 top-2 z-50 flex flex-col items-center gap-3 px-3 lg:left-64 lg:top-3 lg:z-30">
            <button type="button" onClick={() => setView(floatingOpen ? "scrolled" : "scrolled-open")} aria-label="Today’s tip from the advisor"
              className="pointer-events-auto rounded-full bg-background p-1 shadow-sm">
              <HorseMark size={44} dot={!floatingOpen} />
            </button>
            {floatingOpen ? (
              <div className="pointer-events-auto w-[min(30rem,100%)]">
                <TipBubble view="open" onView={(next) => setView(next === "closed" ? "scrolled" : next)} pointer="top-center" className="shadow-sm" />
              </div>
            ) : null}
          </div>
        );
      }
    }

    page = (
      <div className="flex w-full flex-col">
        <h1 className="sr-only">Timeline</h1>
        {banner}
        <div className="relative mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
          {option === "a" && open ? (
            <div className="fixed left-3 right-3 top-[4.5rem] z-40 lg:left-[16.75rem] lg:right-auto lg:top-[14.25rem] lg:w-[24rem]">
              <div className="lg:hidden">{tip("top-right")}</div>
              <div className="hidden lg:block">{tip("left")}</div>
            </div>
          ) : null}
          <OccurrenceMovesProvider actions={NO_MOVES} timezone={TIMEZONE} todayLocalDate="2026-11-19" hasMovedBefore>
            <TimelineScreen statusAction={statusAction} noteAction={noteAction} timeAction={timeAction}
              beforeTimeline={option === "e" ? null : beforeTimeline} inline={inline} />
          </OccurrenceMovesProvider>
          {option === "j" ? <div aria-hidden="true" className="h-[70vh]" /> : null}
          {overlay}
        </div>
      </div>
    );
  }

  const optionRow = (ids: readonly PlacementOption[]) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {PLACEMENT_OPTIONS.filter((item) => ids.includes(item.id)).map((item) => (
        <button key={item.id} type="button" onClick={() => { setOption(item.id); setView(item.id === "f" || item.id === "g" || item.id === "h" || item.id === "j" ? "open" : "closed"); }}
          className={option === item.id ? "font-bold underline underline-offset-4" : "underline underline-offset-4"}>{item.label}</button>
      ))}
    </div>
  );

  return (
    <AppShell user={{ name: "Emi" }} navAccessory={navHorse ? navLine : undefined} mobileHeaderAccessory={headerHorse}>
      {shot ? null : (
        <aside aria-label="Bench controls" className="grid gap-2 border-b border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-950 sm:px-6 lg:px-10"
          style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a href="/design-system" className="underline underline-offset-4">Back to the design-system bench</a>
            <strong>Advisor placement</strong>
            <span className="text-neutral-600">Real app shell and Timeline, synthetic data, nothing is saved.</span>
          </div>
          <p className="text-neutral-600">Round 1</p>
          {optionRow(ROUND_1)}
          <p className="text-neutral-600">Round 1b</p>
          {optionRow(ROUND_1B)}
          <p className="text-neutral-700">{PLACEMENT_OPTIONS.find((item) => item.id === option)?.summary}</p>
        </aside>
      )}
      {page}
    </AppShell>
  );
}
