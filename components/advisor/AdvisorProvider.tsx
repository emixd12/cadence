"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRefresh } from "@cadence/ui/runtime";
import type { AdvisorTip, AdvisorTipLink, AdvisorTipReaction, AdvisorTipsNextResponse } from "@cadence/core/types/advisor-tips";
import type { ScheduleProposalAnswer, ScheduleProposalView } from "@cadence/core/types/behavior-change-proposals";

import {
  advisorErrorText,
  advisorHasNew,
  advisorLineItem,
  followAdvisorLinkOnWeb,
  readBriefSeen,
  writeBriefSeen,
  type AdvisorBriefSummary,
  type AdvisorClient,
  type AdvisorLineItem,
} from "@/lib/ui/advisor";
import { DailyBriefRequestError } from "@/lib/ui/daily-brief";
import {
  isFirstAdvisorOpenToday,
  resolveAdvisorAvatarGesture,
  resolveAdvisorAvatarState,
  type AdvisorAvatarInput,
  type AdvisorAvatarState,
} from "@/lib/resolvers/advisor-avatar.resolver";
import type { AdvisorAvatarGestureEvent } from "./AdvisorAvatar";

/**
 * Advisor plan Phase 4, workstream 4E (placement K, DESIGN.md "Advisor placement").
 * One provider per Timeline holds what the advisor shows: the brief (published by the
 * Daily Brief launcher), the schedule question or trial from 4C, and today's tip from 4B.
 * The horse at the top, the line under today's date and the panel all read it.
 * Opening the app never calls a model: every read here is a stored row.
 */

type Pending = Readonly<{ action: string }> | null;

export type AdvisorProposalState = Readonly<{
  view: ScheduleProposalView;
  /** The italic outcome after an answer on this screen. */
  outcome: string | null;
  pending: ScheduleProposalAnswer | null;
  error: string | null;
  /** After Change for good: the outcome line offers Undo until it is used or the screen reloads. */
  undoable: boolean;
}>;

export type AdvisorTipState = Readonly<{
  tip: AdvisorTip;
  answeredHere: boolean;
  pending: AdvisorTipReaction | null;
  error: string | null;
}>;

type AdvisorContextValue = Readonly<{
  item: AdvisorLineItem | null;
  hasNew: boolean;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  brief: AdvisorBriefSummary;
  tip: AdvisorTipState | null;
  /** The tip's "Why this?" card is open; one switch shared by the line and the panel. */
  researchOpen: boolean;
  toggleResearch: () => void;
  react: (reaction: AdvisorTipReaction) => void;
  proposal: AdvisorProposalState | null;
  answer: (answer: ScheduleProposalAnswer) => void;
  /** Follows a tip's link (an editor field, the Behaviors list or Needs decision); closes the panel first. */
  openLink: (link: AdvisorTipLink) => void;
  /** Tips shown on earlier days; null until the panel first opens or when the read failed. */
  recent: readonly AdvisorTip[] | null;
  /** The panel's last section links here when the Chat page exists (5B/5C pass it). */
  chatHref: string | null;
  /** What the avatar shows: one state, and the latest one-shot gesture. */
  avatar: Readonly<{ state: AdvisorAvatarState | null; gesture: AdvisorAvatarGestureEvent | null }>;
}>;

type BriefSlot = Readonly<{
  publish: (summary: AdvisorBriefSummary) => void;
  /** Where the brief renders: the panel's "Today's brief" section while the panel is open. */
  target: HTMLElement | null;
}>;

const AdvisorContext = createContext<AdvisorContextValue | null>(null);
const AdvisorBriefSlotContext = createContext<BriefSlot | null>(null);
const AdvisorBriefTargetSetter = createContext<((element: HTMLElement | null) => void) | null>(null);

export function useAdvisor() {
  return useContext(AdvisorContext);
}

/** The Daily Brief launcher's way into the advisor. Null outside an advisor (old layout). */
export function useAdvisorBriefSlot() {
  return useContext(AdvisorBriefSlotContext);
}

export function useAdvisorBriefTarget() {
  return useContext(AdvisorBriefTargetSetter);
}

const NONE: AdvisorBriefSummary = { kind: "none" };

export function AdvisorProvider({
  client,
  chatHref = null,
  onOpenLink,
  children,
}: Readonly<{
  client: AdvisorClient | null | undefined;
  chatHref?: string | null;
  /** How a tip's link opens on this platform; the web default loads the Behaviors page. */
  onOpenLink?: (link: AdvisorTipLink) => void;
  children: ReactNode;
}>) {
  if (!client) return <>{children}</>;
  return <AdvisorState client={client} chatHref={chatHref} onOpenLink={onOpenLink ?? followAdvisorLinkOnWeb}>{children}</AdvisorState>;
}

function AdvisorState({ client, chatHref, onOpenLink, children }: Readonly<{
  client: AdvisorClient; chatHref: string | null; onOpenLink: (link: AdvisorTipLink) => void; children: ReactNode;
}>) {
  const refresh = useRefresh();
  const [panelOpen, setPanelOpen] = useState(false);
  const [brief, setBrief] = useState<AdvisorBriefSummary>(NONE);
  const [briefSeenKey, setBriefSeenKey] = useState<string | null>(null);
  const [briefTarget, setBriefTarget] = useState<HTMLElement | null>(null);
  const [tip, setTip] = useState<AdvisorTipState | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [proposal, setProposal] = useState<AdvisorProposalState | null>(null);
  const [recent, setRecent] = useState<readonly AdvisorTip[] | null>(null);
  const [results, setResults] = useState({ applied: 0, refused: 0 });
  const [gesture, setGesture] = useState<AdvisorAvatarGestureEvent | null>(null);
  const avatarInputRef = useRef<AdvisorAvatarInput | null>(null);
  const pending = useRef<Pending>(null);
  const tipRef = useRef(tip);
  const proposalRef = useRef(proposal);
  useEffect(() => { tipRef.current = tip; proposalRef.current = proposal; });

  const applyTip = useCallback((response: AdvisorTipsNextResponse | null) => {
    if (!response) return;
    if (response.state === "tip") {
      setTip((current) => current?.tip.id === response.tip.id && current.answeredHere ? current
        : { tip: response.tip, answeredHere: false, pending: null, error: null });
      setResearchOpen((open) => open && tipRef.current?.tip.id === response.tip.id);
    } else if (!tipRef.current?.answeredHere) {
      setTip(null);
    }
  }, []);

  const applyProposal = useCallback((view: ScheduleProposalView | null) => {
    // An answer given on this screen keeps its outcome until the next open.
    if (!view || proposalRef.current?.outcome) return;
    setProposal(view.kind === "none" || view.kind === "hold" ? null : { view, outcome: null, pending: null, error: null, undoable: false });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const live = <T,>(value: T) => controller.signal.aborted ? null : value;
    const loadTip = () => client.nextTip(controller.signal).then(live, () => null).then(applyTip);
    const loadProposal = () => client.scheduleProposal(controller.signal).then(live, () => null).then(applyProposal);
    void loadTip();
    void loadProposal();
    // Returning to the app is an open: the server decides whether a new tip is due (two hours apart).
    // Asked even when today's tip is unanswered, so a Timeline left open moves on to the next tip.
    const onFocus = () => {
      if (!pending.current) void loadTip();
      if (!proposalRef.current) void loadProposal();
    };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [client, applyTip, applyProposal]);

  const briefKey = brief.kind === "ready" || brief.kind === "closed" ? brief.key : null;
  // Read in render: the brief summary only arrives after mount, so server and client agree.
  const briefSeen = briefKey !== null && (briefSeenKey === briefKey || readBriefSeen(safeStorage(), briefKey));

  const markBriefSeen = useCallback(() => {
    if (!briefKey) return;
    writeBriefSeen(safeStorage(), briefKey);
    setBriefSeenKey(briefKey);
  }, [briefKey]);

  // Opening the panel shows the brief, so it counts as read; a brief delivered earlier reopens there
  // (today's saved brief, no model call).
  const openPanel = useCallback(() => {
    setPanelOpen(true);
    markBriefSeen();
    if (brief.kind === "closed") brief.reopen();
    if (recent === null) void client.recentTips().then(setRecent, () => setRecent([]));
  }, [client, recent, brief, markBriefSeen]);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    // A brief that arrived while the panel was open was seen there.
    markBriefSeen();
  }, [markBriefSeen]);

  const react = useCallback((reaction: AdvisorTipReaction) => {
    const current = tipRef.current;
    if (!current || pending.current) return;
    pending.current = { action: reaction };
    setTip({ ...current, pending: reaction, error: null });
    void client.react(current.tip.id, reaction).then((next) => {
      setTip({ tip: next, answeredHere: true, pending: null, error: null });
      if (reaction !== "helpful") setResearchOpen(false);
      else setResults((counts) => ({ ...counts, applied: counts.applied + 1 }));
    }, (error: unknown) => {
      setResults((counts) => ({ ...counts, refused: counts.refused + 1 }));
      setTip({ ...current, pending: null, error: advisorErrorText(errorCode(error)) });
    }).finally(() => { pending.current = null; });
  }, [client]);

  const answer = useCallback((choice: ScheduleProposalAnswer) => {
    const current = proposalRef.current;
    if (!current || pending.current) return;
    // Once answered, the only answer left is Undo after Change for good.
    if (current.outcome && !(choice === "undo" && current.undoable)) return;
    const view = current.view;
    if (view.kind !== "proposal" && view.kind !== "check_in") return;
    pending.current = { action: choice };
    setProposal({ ...current, pending: choice, error: null });
    void client.answerProposal(view.proposalId, choice).then((result) => {
      setProposal({ view, outcome: result.message, pending: null, error: null, undoable: choice !== "undo" && result.undoable === true });
      if (result.applied) {
        setResults((counts) => ({ ...counts, applied: counts.applied + 1 }));
        refresh();
      }
    }, (error: unknown) => {
      setResults((counts) => ({ ...counts, refused: counts.refused + 1 }));
      setProposal({ ...current, pending: null, error: advisorErrorText(errorCode(error)) });
    }).finally(() => { pending.current = null; });
  }, [client, refresh]);

  const openLink = useCallback((link: AdvisorTipLink) => {
    setPanelOpen(false);
    onOpenLink(link);
  }, [onOpenLink]);

  const item = advisorLineItem({ brief, briefSeen, proposal: proposal?.view ?? null, tip: tip?.tip ?? null, tipAnsweredHere: tip?.answeredHere ?? false });
  const answeredHere = item?.kind === "tip" ? !!tip?.answeredHere
    : item?.kind === "proposal" || item?.kind === "check_in" ? !!proposal?.outcome : false;
  const hasNew = advisorHasNew(item, answeredHere);

  // The avatar: the resolver picks the state, and a change picks at most one gesture.
  const answering = !!(tip?.pending || proposal?.pending);
  const avatarInput = useMemo<AdvisorAvatarInput>(() => ({
    hasNew, panelOpen, brief: brief.kind, answering, replying: false, applied: results.applied, refused: results.refused,
  }), [hasNew, panelOpen, brief.kind, answering, results]);
  useEffect(() => {
    const previous = avatarInputRef.current;
    avatarInputRef.current = avatarInput;
    const next = resolveAdvisorAvatarGesture(previous, avatarInput, previous === null && firstOpenToday(safeStorage()));
    if (next) setGesture((current) => ({ id: next, key: (current?.key ?? 0) + 1 }));
  }, [avatarInput]);
  const avatar = useMemo(() => ({ state: resolveAdvisorAvatarState(avatarInput), gesture }), [avatarInput, gesture]);

  const value = useMemo<AdvisorContextValue>(() => ({
    item, hasNew, panelOpen, openPanel, closePanel, brief, tip,
    researchOpen, toggleResearch: () => setResearchOpen((open) => !open),
    react, proposal, answer, openLink, recent, chatHref, avatar,
  }), [item, hasNew, panelOpen, openPanel, closePanel, brief, tip, researchOpen, react, proposal, answer, openLink, recent, chatHref, avatar]);
  const slot = useMemo<BriefSlot>(() => ({ publish: setBrief, target: panelOpen ? briefTarget : null }), [panelOpen, briefTarget]);

  return (
    <AdvisorContext.Provider value={value}>
      <AdvisorBriefSlotContext.Provider value={slot}>
        <AdvisorBriefTargetSetter.Provider value={setBriefTarget}>
          {children}
        </AdvisorBriefTargetSetter.Provider>
      </AdvisorBriefSlotContext.Provider>
    </AdvisorContext.Provider>
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof DailyBriefRequestError ? error.code : undefined;
}

/** Whether this is the first Timeline open of the local day on this device; records today. */
const AVATAR_DAY_KEY = "cadence.advisor.avatar-day.v1";

function firstOpenToday(storage: Storage | null): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  try {
    const first = isFirstAdvisorOpenToday(storage?.getItem(AVATAR_DAY_KEY) ?? null, today);
    storage?.setItem(AVATAR_DAY_KEY, today);
    return first;
  } catch { return false; }
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
