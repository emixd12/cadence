"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DailyBriefing, DailyBriefSettings } from "@cadence/core/types/daily-brief";

import {
  DailyBriefRequestError,
  DAILY_BRIEF_CLIENT_DEADLINES,
  defaultWebDailyBriefClient,
  dailyBriefInstallationId,
  isDailyBriefPresentationKey,
  markDailyBriefPresentation,
  readDailyBriefPresentation,
  type DailyBriefClient,
} from "@/lib/ui/daily-brief";
import {
  activateDailyBriefClient,
  currentDailyBriefAttempt,
  dailyBriefFence,
  discardDailyBriefAttempt,
  isRememberedDailyBriefAttempt,
  rememberSettledDailyBriefAttempt,
  startDailyBriefAttempt,
  type DailyBriefAttempt,
  type DailyBriefOutcome,
} from "@/lib/ui/daily-brief-session";
import { DAILY_BRIEF_TRAVEL_WAIT_MS, requestDailyBriefTravel, travelConclusionsToken, travelTimesToken, waitForDailyBriefTravel } from "@/lib/ui/travel";
import { useBriefTravel } from "@/lib/ui/brief-travel";
import { briefCalendarBusy } from "@/lib/ui/brief-calendar";
import { DAILY_BRIEF_MOVE_FEATURES } from "@/lib/ui/daily-brief-moves";
import { DAILY_BRIEF_OPPORTUNITY_FEATURES } from "@/lib/ui/daily-brief-opportunities";
import type { BriefPlanningContext } from "@cadence/core/types/brief-moves";
import { noticeText, type NoticeId, type NoticeParams } from "@cadence/core/notices";
import { DailyBriefBubble } from "./DailyBriefBubble";
import { useAdvisorBriefSlot } from "@/components/advisor/AdvisorProvider";

type DailyBriefLauncherProps = Readonly<{
  client?: DailyBriefClient | null;
  travelAccountId?: string | null;
  desktop?: boolean;
  sessionKey?: string;
}>;

type View =
  | Readonly<{ kind: "hidden" }>
  /** Advisor Phase 3: today's brief was shown and closed; a small link reopens it. */
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; briefing: DailyBriefing; attempt: DailyBriefAttempt }>
  | Readonly<{ kind: "notice"; message: string; notice?: NoticeRef; retryLabel?: string; retryAt?: number; action?: PlanAction }>;

/** Ticket 299: a ChatGPT plan notice's primary action. Only the Mac's plan path produces these codes. */
type PlanAction = "manage_usage" | "connect";

const HIDDEN: View = { kind: "hidden" };
const CLOSED: View = { kind: "closed" };

/**
 * Advisor Phase 3: the last brief shown on this page, per client, so reopening after
 * Close needs no request. A reload asks the server, which returns today's saved brief.
 */
const shownBriefings = new WeakMap<DailyBriefClient, Readonly<{ fence: string; briefing: DailyBriefing }>>();

type RefreshState = Readonly<{ pending: boolean; error: RefreshNoticeId | null }>;
const REFRESH_IDLE: RefreshState = { pending: false, error: null };
const TRY_AGAIN = "Try again";

export function DailyBriefLauncher({ client, desktop = false, sessionKey = "current", travelAccountId = null }: DailyBriefLauncherProps) {
  const resolvedClient = useMemo(() => client === undefined ? defaultWebDailyBriefClient() : client, [client]);
  const [view, setView] = useState<View>(HIDDEN);
  const [viewSession, setViewSession] = useState(sessionKey);
  const travel = useBriefTravel();
  const [refreshState, setRefreshState] = useState<RefreshState>(REFRESH_IDLE);
  // Advisor Phase 4 (4E, placement K): inside the advisor the brief lives in the advisor's
  // panel, and the line under today's date says when it is waiting. Elsewhere it keeps its bubble.
  const advisorSlot = useAdvisorBriefSlot();
  const settingsRef = useRef<DailyBriefSettings | null>(null);
  const epoch = useRef(0);
  const actions = useRef<{ retry: () => void; dismiss: () => void; reopen: () => void; refresh: () => void }>({
    retry: () => undefined, dismiss: () => undefined, reopen: () => undefined, refresh: () => undefined,
  });

  useEffect(() => {
    settingsRef.current = null;
    activateDailyBriefClient(resolvedClient);
    // A view from another session stays hidden by the session check in render.
    if (!resolvedClient) return;
    const briefClient = resolvedClient;
    let generation = ++epoch.current;
    const mounted = { current: true };
    const live = () => mounted.current && generation === epoch.current;
    const pendingTimers = new Set<number>();
    const later = (callback: () => void, at: number) => {
      const timer = window.setTimeout(() => { pendingTimers.delete(timer); if (live()) callback(); },
        Math.min(2_147_483_647, Math.max(0, at - Date.now())));
      pendingTimers.add(timer);
    };
    const show = (next: View) => { if (live()) { setView(next); setViewSession(sessionKey); } };
    const mark = (settings: DailyBriefSettings, patch: Partial<ReturnType<typeof readDailyBriefPresentation>>) => {
      try {
        const current = readDailyBriefPresentation(settings.accountRef, settings.localDate);
        // Any write without a new claim clears the previous cross-tab claim.
        markDailyBriefPresentation(settings.accountRef, settings.localDate, {
          attempted: patch.attempted ?? current.attempted,
          delivered: patch.delivered ?? current.delivered,
          dismissed: patch.dismissed ?? current.dismissed,
          ...(patch.pendingUntil === undefined ? {} : { pendingUntil: patch.pendingUntil }),
        });
      } catch {
        // Storage can be unavailable; presentation then lasts only for this page session.
      }
    };

    const present = (settings: DailyBriefSettings, attempt: DailyBriefAttempt, outcome: DailyBriefOutcome) => {
      if (!live() || !isRememberedDailyBriefAttempt(briefClient, attempt)) return;
      const marker = readDailyBriefPresentation(settings.accountRef, settings.localDate);
      if (marker.dismissed) { show(closedOrHidden(settings)); return; }
      if (outcome.kind === "ready") {
        // Advisor Phase 3: a brief stays until it is closed or the day ends. Each move line is
        // checked when it is answered, so neither a timer nor a Timeline change withdraws it.
        if (travelAccountId) requestDailyBriefTravel(travelAccountId, outcome.briefing.localDate, outcome.briefing.generatedAt);
        mark(settings, { attempted: true, delivered: true });
        shownBriefings.set(briefClient, { fence: dailyBriefFence(settings), briefing: outcome.briefing });
        show({ kind: "ready", briefing: outcome.briefing, attempt });
        return;
      }
      if (outcome.kind === "already_attempted") {
        show(marker.delivered ? CLOSED : { kind: "notice", ...briefNotice("brief.already-started"), retryLabel: TRY_AGAIN });
        return;
      }
      const notice = failureNotice(outcome);
      show(notice);
      if (notice.retryAt) later(() => { if (isRememberedDailyBriefAttempt(briefClient, attempt)) show({ ...notice, retryAt: undefined }); }, notice.retryAt);
    };

    const follow = (settings: DailyBriefSettings, attempt: DailyBriefAttempt) => {
      if (attempt.outcome) { present(settings, attempt, attempt.outcome); return; }
      show({ kind: "loading" });
      void attempt.promise.then((outcome) => present(settings, attempt, outcome));
    };

    const start = (settings: DailyBriefSettings, retry: boolean) => {
      setRefreshState(REFRESH_IDLE);
      // The first brief of the day may first wait for travel (Ticket 272), so its claim covers that wait.
      const claim = Date.now() + DAILY_BRIEF_CLIENT_DEADLINES.installationMs + DAILY_BRIEF_CLIENT_DEADLINES.briefMs + (retry ? 0 : DAILY_BRIEF_TRAVEL_WAIT_MS);
      mark(settings, { attempted: true, pendingUntil: claim });
      const attempt = startDailyBriefAttempt(briefClient, settings, {
        retry,
        run: async (signal) => {
          // Ticket 219 Option A: the latest signed travel conclusions for this account and day, if any.
          // Account-free desktop has no travel account, so it sends nothing. Ticket 272: the day's
          // first brief waits up to 5 seconds for the first travel result. It does not wait with
          // travel off, not configured or not mounted, and a retry uses the token it has.
          const [installationId, travelConclusions] = await Promise.all([
            dailyBriefInstallationId(window.localStorage, signal),
            retry ? travelConclusionsToken(travelAccountId, settings.localDate) : waitForDailyBriefTravel(travelAccountId, settings.localDate, signal),
          ]);
          return briefClient.requestBrief({ installationId, retry, ...(travelConclusions ? { travelConclusions } : {}), ...moveRequestFields(briefClient, travelAccountId, settings.localDate) }, signal);
        },
      });
      // Clear this tab's cross-tab claim when the attempt settles, even if this launcher
      // unmounted. Another tab's newer claim stays in place.
      void attempt.promise.then(() => {
        if (isRememberedDailyBriefAttempt(briefClient, attempt) &&
            readDailyBriefPresentation(settings.accountRef, settings.localDate).pendingUntil === claim) mark(settings, {});
      });
      follow(settings, attempt);
    };

    let evaluated = false;
    /** Decide what this mount shows. Only the first evaluation of the day may start automatically. */
    const evaluate = (settings: DailyBriefSettings, allowStart: boolean) => {
      if (!live()) return;
      evaluated = true;
      const marker = readDailyBriefPresentation(settings.accountRef, settings.localDate);
      if (marker.dismissed) { discardDailyBriefAttempt(briefClient); show(closedOrHidden(settings)); return; }
      const attempt = currentDailyBriefAttempt(briefClient, settings);
      if (attempt) { follow(settings, attempt); return; }
      if (!marker.attempted) {
        if (allowStart) start(settings, false); else show(HIDDEN);
        return;
      }
      if (marker.delivered) { show(closedOrHidden(settings)); return; }
      if (marker.pendingUntil && marker.pendingUntil > Date.now()) {
        // Another tab or an earlier page load owns the attempt; recheck when its client deadline passes.
        show(HIDDEN);
        later(() => evaluate(settings, false), marker.pendingUntil + 1);
        return;
      }
      show({ kind: "notice", ...briefNotice("brief.did-not-finish"), retryLabel: TRY_AGAIN });
    };

    const withdraw = () => {
      discardDailyBriefAttempt(briefClient);
      settingsRef.current = null;
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      // Late work from the withdrawn settings is ignored, but this mount stays live:
      // a later read (for example the next local day) may make that day's automatic start.
      evaluated = false;
      generation = ++epoch.current;
      setView(HIDDEN);
    };

    const load = (allowStart: boolean, retry = false) => {
      if (desktop && !navigator.onLine) return;
      const loadEpoch = epoch.current;
      void briefClient.preferences().then((settings) => {
        if (!mounted.current || loadEpoch !== epoch.current) return;
        if (!settings.available || !settings.enabled) { withdraw(); return; }
        if (retry) {
          settingsRef.current = settings;
          if (!readDailyBriefPresentation(settings.accountRef, settings.localDate).dismissed) start(settings, true);
          return;
        }
        const previous = settingsRef.current;
        if (previous && dailyBriefFence(previous) !== dailyBriefFence(settings)) {
          // A new local day (or another device's settings change) replaces the old
          // attempt; evaluate the new settings now so a new day's start is not delayed.
          withdraw();
          settingsRef.current = settings;
          evaluate(settings, true);
          return;
        }
        settingsRef.current = settings;
        if (!previous) evaluate(settings, allowStart);
      }).catch(() => {
        if (!mounted.current || loadEpoch !== epoch.current) return;
        if (retry) { show({ kind: "notice", ...briefNotice("brief.did-not-finish"), retryLabel: TRY_AGAIN }); return; }
        // Enablement is unknown, so stay out of the way; focus or reconnection checks again.
        if (settingsRef.current) withdraw();
        else setView(HIDDEN);
      });
    };

    actions.current = {
      retry: () => {
        const settings = settingsRef.current;
        if (!live()) return;
        // A plan change withdrew the previous settings. A deliberate reconnect still gets one fresh retry.
        if (!settings) { load(false, true); return; }
        if (readDailyBriefPresentation(settings.accountRef, settings.localDate).dismissed) return;
        start(settings, true);
      },
      dismiss: () => {
        const settings = settingsRef.current;
        if (settings) mark(settings, { attempted: true, dismissed: true });
        discardDailyBriefAttempt(briefClient);
        epoch.current += 1;
        generation = epoch.current;
        setRefreshState(REFRESH_IDLE);
        setView(settings ? closedOrHidden(settings) : HIDDEN);
      },
      reopen: () => {
        const settings = settingsRef.current;
        if (!settings || !live()) return;
        // Reopening is the person's choice: clear Close for today, then show the brief.
        mark(settings, { attempted: true, dismissed: false });
        const remembered = shownBriefings.get(briefClient);
        if (remembered && remembered.fence === dailyBriefFence(settings)) {
          show({ kind: "ready", briefing: remembered.briefing, attempt: reopenedAttempt(settings) });
          return;
        }
        // The server returns today's saved brief with no new model call (advisor Phase 3, 3A2).
        start(settings, false);
      },
      refresh: () => {
        const settings = settingsRef.current;
        if (!settings || !live()) return;
        const refreshEpoch = generation;
        setRefreshState({ pending: true, error: null });
        void (async () => {
          try {
            const installationId = await dailyBriefInstallationId(window.localStorage);
            const travelConclusions = travelConclusionsToken(travelAccountId, settings.localDate);
            const response = await briefClient.requestBrief({
              installationId, retry: false, refresh: true,
              ...(travelConclusions ? { travelConclusions } : {}),
              ...moveRequestFields(briefClient, travelAccountId, settings.localDate),
            });
            if (!live() || refreshEpoch !== generation) return;
            if (response.state !== "ready") { setRefreshState({ pending: false, error: "brief.refresh.not-ready" }); return; }
            shownBriefings.set(briefClient, { fence: dailyBriefFence(settings), briefing: response.briefing });
            setRefreshState(REFRESH_IDLE);
            show({ kind: "ready", briefing: response.briefing, attempt: rememberSettledDailyBriefAttempt(briefClient, settings, response.briefing) });
          } catch (error) {
            if (!live() || refreshEpoch !== generation) return;
            setRefreshState({ pending: false, error: refreshFailure(error) });
          }
        })();
      },
    };

    const stopPlan = briefClient.plan?.subscribe?.((phase) => {
      if (phase === "start") withdraw();
      else load(false);
    });
    load(true);

    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<{ accountRef?: string; startNow?: boolean }>).detail;
      if (!next?.accountRef || next.accountRef === settingsRef.current?.accountRef) withdraw();
      // Answering the AI features question (4F) turns the brief on: read the settings again and start today's brief.
      if (next?.startNow) load(true);
    };
    // A mount that never read preferences (failure or offline desktop) may still make the day's automatic start.
    const onFocus = () => load(!evaluated);
    const onOnline = () => load(!evaluated);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "cadence.daily-brief.settings-revision.v1") { withdraw(); return; }
      const settings = settingsRef.current;
      if (!settings || !isDailyBriefPresentationKey(event.key)) return;
      const marker = readDailyBriefPresentation(settings.accountRef, settings.localDate);
      if (marker.dismissed) { discardDailyBriefAttempt(briefClient); epoch.current += 1; generation = epoch.current; setView(closedOrHidden(settings)); return; }
      // Another tab delivered, failed or claimed an attempt; re-evaluate without starting automatically.
      const own = currentDailyBriefAttempt(briefClient, settings);
      if (!own) evaluate(settings, false);
      else if (own.outcome && own.outcome.kind !== "ready" && marker.delivered) show(CLOSED);
    };
    window.addEventListener("cadence:daily-brief-settings", onSettings);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      stopPlan?.();
      for (const timer of pendingTimers) window.clearTimeout(timer);
      window.removeEventListener("cadence:daily-brief-settings", onSettings);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
      // The remembered attempt survives an unmount so a remount can reattach to it.
    };
  }, [resolvedClient, desktop, sessionKey, travelAccountId]);

  const publishBrief = advisorSlot?.publish;
  useEffect(() => {
    if (!publishBrief) return;
    const settings = settingsRef.current;
    const key = settings ? `${settings.accountRef}:${settings.localDate}` : null;
    if (!resolvedClient || viewSession !== sessionKey || view.kind === "hidden") publishBrief({ kind: "none" });
    else if (view.kind === "loading") publishBrief({ kind: "loading" });
    else if (view.kind === "notice") publishBrief({ kind: "notice" });
    else if (view.kind === "closed") publishBrief(key ? { kind: "closed", key, reopen: () => actions.current.reopen() } : { kind: "none" });
    else publishBrief({ kind: "ready", key: key ?? `${sessionKey}:${view.briefing.localDate}`, openMoves: openMoveCount(view.briefing) });
  }, [publishBrief, resolvedClient, view, viewSession, sessionKey]);
  useEffect(() => () => publishBrief?.({ kind: "none" }), [publishBrief]);
  const embedded = !!advisorSlot;
  const place = (node: ReactNode) => !advisorSlot ? node : advisorSlot.target ? createPortal(node, advisorSlot.target) : null;

  if (!resolvedClient || view.kind === "hidden" || viewSession !== sessionKey) return null;
  const onDismiss = () => actions.current.dismiss();
  if (view.kind === "closed") return place(<ReopenBriefLink embedded={embedded} onReopen={() => actions.current.reopen()} />);
  if (view.kind === "loading") return place(<DailyBriefBubble state="loading" onDismiss={onDismiss} embedded={embedded} />);
  const shown = view;
  const planControls = resolvedClient.plan;
  // A cancelled or failed sign-in leaves the notice in place; a finished one retries the brief.
  const connectPlan = () => {
    const pending = planControls?.connect();
    // Starting the sign-in may synchronously withdraw this view. Later account changes must still fence its callback.
    const current = epoch.current;
    void pending?.then(() => { if (current === epoch.current) actions.current.retry(); }, () => undefined);
  };
  if (shown.kind === "ready") {
    const usage = planControls?.usage(shown.briefing) ?? null;
    const plan = planControls && usage ? { usage, onManageUsage: planControls.manageUsage, onConnect: connectPlan } : null;
    const moveClient = resolvedClient.moves;
    const moves = moveClient ? {
      client: moveClient,
      planningContext: (): BriefPlanningContext => {
        const travelTimes = travelTimesToken(travelAccountId, shown.briefing.localDate);
        return { calendarBusy: briefCalendarBusy(), ...(travelTimes ? { travelTimes } : {}) };
      },
    } : null;
    const refresh = moveClient ? {
      onRefresh: () => actions.current.refresh(),
      pending: refreshState.pending,
      error: refreshState.error,
      available: refreshAvailability(shown.briefing),
    } : null;
    const opportunityClient = resolvedClient.opportunities;
    const opportunities = moves && opportunityClient ? { client: opportunityClient, planningContext: moves.planningContext } : null;
    return place(<DailyBriefBubble state="ready" briefing={shown.briefing} travel={travel} onDismiss={onDismiss} plan={plan} moves={moves} opportunities={opportunities} refresh={refresh} embedded={embedded} />);
  }
  if (shown.kind !== "notice") return null;
  const action = planControls && shown.action === "manage_usage" ? { label: "Manage usage", onClick: planControls.manageUsage }
    : planControls && shown.action === "connect" ? { label: "Continue with ChatGPT", onClick: connectPlan, chatGpt: true } : undefined;
  return place(
    <DailyBriefBubble
      embedded={embedded}
      state="error"
      message={shown.message}
      messageNotice={shown.notice}
      action={action}
      onDismiss={onDismiss}
      onRetry={shown.retryLabel ? () => actions.current.retry() : undefined}
      retryLabel={shown.retryLabel}
      retryDisabled={shown.retryAt !== undefined}
    />
  );
}

/** A Timeline link that reopens today's brief after Close. Text-like, right-aligned under the horse. */
function ReopenBriefLink({ onReopen, embedded }: Readonly<{ onReopen: () => void; embedded: boolean }>) {
  if (embedded) {
    return <p><button type="button" onClick={onReopen} className="underline underline-offset-2">Open today’s brief</button></p>;
  }
  return (
    <p className="relative z-10 -mt-6 ml-auto w-fit text-sm leading-6 text-muted-readable sm:-mt-4" data-daily-brief-reopen>
      <button type="button" onClick={onReopen} className="-my-2 inline-block min-h-11 py-2 underline underline-offset-2 hover:text-foreground">
        Today’s brief
      </button>
    </p>
  );
}

/** Move lines still waiting for an answer, for the advisor's line ("2 moves suggested for today."). */
function openMoveCount(briefing: DailyBriefing): number {
  return briefing.moves?.lines.filter((line) => line.status === "proposed").length ?? 0;
}

/** Closed today: show the reopen link when a brief was delivered on this device, else nothing. */
function closedOrHidden(settings: DailyBriefSettings): View {
  return readDailyBriefPresentation(settings.accountRef, settings.localDate).delivered ? CLOSED : HIDDEN;
}

/** The brief request's move fields: only clients that can answer ask for move lines. */
function moveRequestFields(client: DailyBriefClient, travelAccountId: string | null, localDate: string) {
  if (!client.moves) return {};
  const travelTimes = travelTimesToken(travelAccountId, localDate);
  const features = [...DAILY_BRIEF_MOVE_FEATURES, ...(client.opportunities ? DAILY_BRIEF_OPPORTUNITY_FEATURES : [])];
  return { features, ...(travelTimes ? { travelTimes } : {}) };
}

/** A settled stand-in attempt for a brief shown again from memory. */
function reopenedAttempt(settings: DailyBriefSettings): DailyBriefAttempt {
  return {
    accountRef: settings.accountRef, localDate: settings.localDate, fence: dailyBriefFence(settings),
    retry: false, controller: new AbortController(), promise: new Promise(() => undefined),
  };
}

/** Advisor Phase 3 (3A2): the server says whether a refresh is still allowed today. */
function refreshAvailability(briefing: DailyBriefing): boolean {
  const refresh = (briefing as DailyBriefing & Readonly<{ refresh?: Readonly<{ available?: boolean }> }>).refresh;
  return refresh?.available !== false;
}

function refreshFailure(error: unknown): RefreshNoticeId {
  const code = error instanceof DailyBriefRequestError ? error.code : "brief_unavailable";
  switch (code) {
    case "refresh_limit_reached": return "brief.refresh.limit-reached";
    case "budget_reached": return "brief.refresh.budget";
    case "offline": return "brief.refresh.offline";
    case "rate_limited": return "brief.refresh.rate-limited";
    default: return "brief.refresh.failed";
  }
}

/** A Refresh failure, named by its notice. The brief shows it under "Not refreshed". */
export type RefreshNoticeId = Extract<NoticeId, `brief.refresh.${string}`>;

type NoticeRef = Readonly<{ id: NoticeId; params?: NoticeParams }>;

/** The launcher's message for a notice: its words, plus the id so the brief shows it in the notice's style. */
function briefNotice(id: NoticeId, params?: NoticeParams): Readonly<{ message: string; notice: NoticeRef }> {
  return { message: noticeText(id, params), notice: { id, ...(params ? { params } : {}) } };
}

function failureNotice(outcome: Extract<DailyBriefOutcome, { kind: "failed" }>): Extract<View, { kind: "notice" }> {
  const retryAt = outcome.retryAfterSeconds ? outcome.settledAt + outcome.retryAfterSeconds * 1000 : undefined;
  const wait = { wait: outcome.retryAfterSeconds ? formatWait(outcome.retryAfterSeconds) : "none" };
  switch (outcome.code) {
    case "pending":
      return { kind: "notice", ...briefNotice("brief.still-preparing", wait), retryLabel: TRY_AGAIN, retryAt };
    case "rate_limited":
      return { kind: "notice", ...briefNotice("brief.request-limit", wait), retryLabel: TRY_AGAIN, retryAt };
    case "timeout":
      return { kind: "notice", ...briefNotice("brief.timeout"), retryLabel: TRY_AGAIN };
    case "offline":
      return { kind: "notice", ...briefNotice("brief.offline"), retryLabel: TRY_AGAIN };
    case "unauthenticated":
      return { kind: "notice", ...briefNotice("brief.sign-in-again") };
    case "context_changed":
    case "context_expired":
      return { kind: "notice", ...briefNotice("brief.context-changed"), retryLabel: "Get a current brief" };
    case "retry_exhausted":
      return { kind: "notice", ...briefNotice("brief.retry-exhausted") };
    // Advisor plan Phase 1A: the account's monthly advisor budget refused the model call.
    case "budget_reached":
      return { kind: "notice", ...briefNotice("brief.month-limit") };
    case "access_denied":
    case "not_configured":
      return { kind: "notice", ...briefNotice("brief.turned-off") };
    case "brief_unavailable":
      return { kind: "notice", ...briefNotice("brief.unavailable"), retryLabel: TRY_AGAIN };
    // Ticket 299 (D27): the Mac's ChatGPT plan could not run the brief. Cadence does not run it another way.
    case "chatgpt_usage_limit":
      return { kind: "notice", ...briefNotice("brief.chatgpt-usage-limit"), action: "manage_usage", retryLabel: TRY_AGAIN };
    case "chatgpt_not_eligible":
      return { kind: "notice", ...briefNotice("brief.chatgpt-not-eligible") };
    case "chatgpt_reconnect":
      return { kind: "notice", ...briefNotice("brief.chatgpt-reconnect"), action: "connect" };
    case "chatgpt_retry_later":
    case "chatgpt_timeout":
    case "chatgpt_advisor_unavailable":
    case "chatgpt_unavailable":
      return { kind: "notice", ...briefNotice("brief.chatgpt-retry-later"), retryLabel: TRY_AGAIN };
    default:
      return { kind: "notice", ...(outcome.recovery ? { message: outcome.recovery } : briefNotice("brief.could-not-prepare")), retryLabel: TRY_AGAIN };
  }
}

function formatWait(seconds: number) {
  return seconds < 90 ? `${Math.ceil(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}
