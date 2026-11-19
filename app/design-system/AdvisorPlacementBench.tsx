"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppShell } from "@/components/layout/AppShell";
import { Timeline } from "@/components/timeline/Timeline";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import type { OccurrenceFormAction, TimeTrackingFormAction, TimelineOccurrenceInput } from "@/lib/types/timeline";

// Advisor plan 4D, round 1: where the advisor (the horse) shows its tips.
// Five placements on the real app shell and Timeline, synthetic data, nothing is saved.
// One URL reproduces one view: ?preview=advisor-placement&option=a&view=why

export type PlacementOption = "a" | "a2" | "b" | "c" | "d";
export type PlacementView = "closed" | "open" | "why" | "answered";

export const PLACEMENT_OPTIONS: readonly Readonly<{ id: PlacementOption; label: string; summary: string }>[] = [
  { id: "a", label: "A · Horse in the menu", summary: "An Advisor line in the main menu, with the horse as its icon. A dot means a new tip." },
  { id: "a2", label: "A2 · Menu horse opens Chat", summary: "The same menu line opens the Advisor page: today’s tip on top, then the chat." },
  { id: "b", label: "B · Banner horse", summary: "The Timeline’s own horse gets a dot. Tapping it opens the tip in the brief’s bubble." },
  { id: "c", label: "C · Corner horse", summary: "A small horse waits in a screen corner on every page. A dot means a new tip." },
  { id: "d", label: "D · Line in the Timeline", summary: "The tip is a quiet line between what is done today and what comes next." },
];

const TIMEZONE = "America/New_York";

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

function occurrence(id: string, title: string, scheduledFor: string, localDate: string, label: string,
  status: TimelineOccurrenceInput["status"] = "unresolved"): TimelineOccurrenceInput {
  return {
    id, behaviorId: `behavior-${id}`, title, scheduledFor, scheduledTimeLabel: label, localDate, status,
    statusMarkedAt: status === "unresolved" ? null : scheduledFor,
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

/** The advisor's head, cropped from the avatar artwork. `dot` marks an unseen tip. */
function HorseMark({ size = 28, dot = false }: Readonly<{ size?: number; dot?: boolean }>) {
  // The head spans about x 75–330 and y 85–330 in the 400 × 400 artwork.
  const scale = size / 250;
  return (
    <span aria-hidden="true" className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span className="absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/cadence-horse-avatar.png" alt="" className="absolute max-w-none"
          style={{ width: 400 * scale, height: 400 * scale, left: -75 * scale, top: -85 * scale }} />
      </span>
      {dot ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

// ---------- The tip itself (shared by every option) ----------

function TipBody({ view, onView }: Readonly<{ view: PlacementView; onView: (view: PlacementView) => void }>) {
  return (
    <div className="text-sm leading-6">
      <p className="break-words text-foreground">{QUIP}</p>
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
  pointer: "top-right" | "top-left" | "left" | "bottom-left" | "bottom-right"; className?: string;
}>) {
  const pointerClass = {
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

function TimelineScreen({ statusAction, noteAction, timeAction, beforeTimeline, afterRow }: Readonly<{
  statusAction: OccurrenceFormAction; noteAction: OccurrenceFormAction; timeAction: TimeTrackingFormAction;
  beforeTimeline?: ReactNode; afterRow?: Readonly<{ occurrenceId: string; content: ReactNode }>;
}>) {
  // The Timeline owns its rows, so the bench line is mounted in its own root after the chosen row.
  const rootRef = useRef<Readonly<{ root: Root; holder: HTMLElement }> | null>(null);
  const rowId = afterRow?.occurrenceId;
  useLayoutEffect(() => {
    if (!rowId) return;
    const row = document.querySelector(`[data-occurrence-id="${rowId}"]`);
    const anchor = row?.closest("li") ?? row;
    if (!anchor?.parentElement) return;
    const holder = document.createElement(anchor.tagName === "LI" ? "li" : "div");
    holder.dataset.advisorInline = "";
    anchor.after(holder);
    rootRef.current = { root: createRoot(holder), holder };
    return () => {
      const mounted = rootRef.current;
      rootRef.current = null;
      queueMicrotask(() => { mounted?.root.unmount(); mounted?.holder.remove(); });
    };
  }, [rowId]);
  useLayoutEffect(() => { rootRef.current?.root.render(afterRow?.content ?? null); });
  return (
    <>
      {beforeTimeline}
      <Timeline timeline={TIMELINE} statusAction={statusAction} noteAction={noteAction}
        startTimeTrackingAction={timeAction} stopTimeTrackingAction={timeAction} resetTimeTrackingAction={timeAction} />
    </>
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

export function AdvisorPlacementBench({ statusAction, noteAction, timeAction, initialOption, initialView, shot }: Readonly<{
  statusAction: OccurrenceFormAction; noteAction: OccurrenceFormAction; timeAction: TimeTrackingFormAction;
  initialOption: PlacementOption; initialView: PlacementView; shot: boolean;
}>) {
  const [option, setOption] = useState<PlacementOption>(initialOption);
  const [view, setView] = useState<PlacementView>(initialView);
  const open = view !== "closed";
  const unseen = view === "closed";

  const navHorse = option === "a" || option === "a2";
  const navLine = (collapsed: boolean) => navHorse ? (
    <button type="button" onClick={() => setView(open ? "closed" : "open")} aria-current={option === "a2" && open ? "page" : undefined}
      className={["group flex h-10 w-full items-center overflow-hidden text-sm", option === "a2" && open ? "bg-timeline-row-hover text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"].join(" ")}>
      <span className="flex h-10 w-16 shrink-0 items-center justify-center"><HorseMark size={26} dot={unseen} /></span>
      {collapsed ? null : <span className="whitespace-nowrap text-sm">Advisor</span>}
    </button>
  ) : null;
  const headerHorse = navHorse ? (
    <button type="button" aria-label="Advisor" onClick={() => setView(open ? "closed" : "open")} className="flex h-16 w-14 items-center justify-center">
      <HorseMark size={30} dot={unseen} />
    </button>
  ) : null;

  const tip = (pointer: Parameters<typeof TipBubble>[0]["pointer"], className?: string) =>
    <TipBubble view={view} onView={setView} pointer={pointer} className={className} />;

  let page: ReactNode;
  if (option === "a2" && open) {
    page = <AdvisorChatPage view={view} onView={setView} />;
  } else {
    let beforeTimeline: ReactNode = null;
    let afterRow: Readonly<{ occurrenceId: string; content: ReactNode }> | undefined;
    let overlay: ReactNode = null;
    if (option === "b") {
      beforeTimeline = open ? tip("top-right", "ml-auto -mt-8 w-full sm:-mt-6 sm:w-[min(40rem,100%)] mb-6")
        : <ReopenRow><button type="button" className="underline underline-offset-2">Today’s brief</button></ReopenRow>;
    } else {
      beforeTimeline = <ReopenRow><button type="button" className="underline underline-offset-2">Today’s brief</button></ReopenRow>;
    }
    if (option === "d" && view !== "closed") {
      afterRow = {
        occurrenceId: "walk",
        content: (
          <div className="flex gap-3 border-b border-line py-4 sm:pl-2" data-advisor-line>
            <HorseMark size={32} />
            <div className="min-w-0 flex-1"><TipBody view={view} onView={setView} /></div>
          </div>
        ),
      };
    }
    if (option === "c") {
      overlay = (
        <div className="fixed bottom-24 right-3 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:left-[17rem] lg:right-auto lg:items-start">
          {open ? tip("bottom-right", "w-[min(22rem,calc(100vw-1.5rem))] lg:order-none") : null}
          <button type="button" aria-label="Advisor" onClick={() => setView(open ? "closed" : "open")}
            className="flex h-14 w-14 items-center justify-center bg-background">
            <HorseMark size={44} dot={unseen} />
          </button>
        </div>
      );
    }
    page = (
      <div className="flex w-full flex-col">
        <h1 className="sr-only">Timeline</h1>
        <Banner dot={option === "b" && unseen} onHorse={option === "b" ? () => setView(open ? "closed" : "open") : undefined} />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
          {option === "a" && open ? (
            <div className="fixed left-3 right-3 top-[4.5rem] z-40 lg:left-[16.75rem] lg:right-auto lg:top-[14.25rem] lg:w-[24rem]">
              <div className="lg:hidden">{tip("top-right")}</div>
              <div className="hidden lg:block">{tip("left")}</div>
            </div>
          ) : null}
          <OccurrenceMovesProvider actions={NO_MOVES} timezone={TIMEZONE} todayLocalDate="2026-11-19" hasMovedBefore>
            <TimelineScreen statusAction={statusAction} noteAction={noteAction} timeAction={timeAction}
              beforeTimeline={beforeTimeline} afterRow={afterRow} />
          </OccurrenceMovesProvider>
          {overlay}
        </div>
      </div>
    );
  }

  return (
    <AppShell user={{ name: "Emi" }} navAccessory={navHorse ? navLine : undefined} mobileHeaderAccessory={headerHorse}>
      {shot ? null : (
        <aside aria-label="Bench controls" className="grid gap-2 border-b border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-950 sm:px-6 lg:px-10"
          style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a href="/design-system" className="underline underline-offset-4">Back to the design-system bench</a>
            <strong>Advisor placement, round 1</strong>
            <span className="text-neutral-600">Real app shell and Timeline, synthetic data, nothing is saved.</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PLACEMENT_OPTIONS.map((item) => (
              <button key={item.id} type="button" onClick={() => { setOption(item.id); setView("closed"); }}
                className={option === item.id ? "font-bold underline underline-offset-4" : "underline underline-offset-4"}>{item.label}</button>
            ))}
          </div>
          <p className="text-neutral-700">{PLACEMENT_OPTIONS.find((item) => item.id === option)?.summary}</p>
        </aside>
      )}
      {page}
    </AppShell>
  );
}
