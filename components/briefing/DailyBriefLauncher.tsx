"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyBriefing, DailyBriefSettings } from "@cadence/core/types/daily-brief";

import {
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
  startDailyBriefAttempt,
  type DailyBriefAttempt,
  type DailyBriefOutcome,
} from "@/lib/ui/daily-brief-session";
import { DAILY_BRIEF_TRAVEL_WAIT_MS, requestDailyBriefTravel, travelConclusionsToken, waitForDailyBriefTravel } from "@/lib/ui/travel";
import { useBriefTravel } from "@/lib/ui/brief-travel";
import { DailyBriefBubble } from "./DailyBriefBubble";

type DailyBriefLauncherProps = Readonly<{
  client?: DailyBriefClient | null;
  travelAccountId?: string | null;
  desktop?: boolean;
  sessionKey?: string;
  /** Observed Timeline facts. A change withdraws a delivered brief instead of remounting the launcher. */
  sourceKey?: string;
}>;

type View =
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; briefing: DailyBriefing; attempt: DailyBriefAttempt }>
  | Readonly<{ kind: "notice"; message: string; retryLabel?: string; retryAt?: number; action?: PlanAction }>;

/** Ticket 299: a ChatGPT plan notice's primary action. Only the Mac's plan path produces these codes. */
type PlanAction = "manage_usage" | "connect";

const HIDDEN: View = { kind: "hidden" };
const TRY_AGAIN = "Try again";

export function DailyBriefLauncher({ client, desktop = false, sessionKey = "current", sourceKey = "", travelAccountId = null }: DailyBriefLauncherProps) {
  const resolvedClient = useMemo(() => client === undefined ? defaultWebDailyBriefClient() : client, [client]);
  const [view, setView] = useState<View>(HIDDEN);
  const [viewSession, setViewSession] = useState(sessionKey);
  const travel = useBriefTravel();
  const settingsRef = useRef<DailyBriefSettings | null>(null);
  const sourceKeyRef = useRef(sourceKey);
  const epoch = useRef(0);
  const actions = useRef<{ retry: () => void; dismiss: () => void }>({ retry: () => undefined, dismiss: () => undefined });

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
      if (marker.dismissed) { show(HIDDEN); return; }
      if (outcome.kind === "ready") {
        if (!(Date.parse(outcome.briefing.expiresAt) > Date.now())) { show(expiredNotice()); return; }
        if (attempt.sourceKey !== sourceKeyRef.current) { show(staleNotice()); return; }
        if (travelAccountId) requestDailyBriefTravel(travelAccountId, outcome.briefing.localDate, outcome.briefing.generatedAt);
        mark(settings, { attempted: true, delivered: true });
        show({ kind: "ready", briefing: outcome.briefing, attempt });
        later(() => { if (isRememberedDailyBriefAttempt(briefClient, attempt)) show(expiredNotice()); }, Date.parse(outcome.briefing.expiresAt));
        return;
      }
      if (outcome.kind === "already_attempted") {
        show(marker.delivered ? HIDDEN : { kind: "notice", message: "Today’s Daily Brief was already started but not shown here.", retryLabel: TRY_AGAIN });
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
      // The first brief of the day may first wait for travel (Ticket 272), so its claim covers that wait.
      const claim = Date.now() + DAILY_BRIEF_CLIENT_DEADLINES.installationMs + DAILY_BRIEF_CLIENT_DEADLINES.briefMs + (retry ? 0 : DAILY_BRIEF_TRAVEL_WAIT_MS);
      mark(settings, { attempted: true, pendingUntil: claim });
      const attempt = startDailyBriefAttempt(briefClient, settings, {
        sourceKey: sourceKeyRef.current,
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
          return briefClient.requestBrief({ installationId, retry, ...(travelConclusions ? { travelConclusions } : {}) }, signal);
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
      if (marker.dismissed) { discardDailyBriefAttempt(briefClient); show(HIDDEN); return; }
      const attempt = currentDailyBriefAttempt(briefClient, settings);
      if (attempt) { follow(settings, attempt); return; }
      if (!marker.attempted) {
        if (allowStart) start(settings, false); else show(HIDDEN);
        return;
      }
      if (marker.delivered) { show(HIDDEN); return; }
      if (marker.pendingUntil && marker.pendingUntil > Date.now()) {
        // Another tab or an earlier page load owns the attempt; recheck when its client deadline passes.
        show(HIDDEN);
        later(() => evaluate(settings, false), marker.pendingUntil + 1);
        return;
      }
      show({ kind: "notice", message: "Today’s Daily Brief did not finish loading.", retryLabel: TRY_AGAIN });
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
        if (retry) { show({ kind: "notice", message: "Today’s Daily Brief did not finish loading.", retryLabel: TRY_AGAIN }); return; }
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
        setView(HIDDEN);
      },
    };

    const stopPlan = briefClient.plan?.subscribe?.((phase) => {
      if (phase === "start") withdraw();
      else load(false);
    });
    load(true);

    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<{ accountRef?: string }>).detail;
      if (!next?.accountRef || next.accountRef === settingsRef.current?.accountRef) withdraw();
    };
    // A mount that never read preferences (failure or offline desktop) may still make the day's automatic start.
    const onFocus = () => load(!evaluated);
    const onOnline = () => load(!evaluated);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "cadence.daily-brief.settings-revision.v1") { withdraw(); return; }
      const settings = settingsRef.current;
      if (!settings || !isDailyBriefPresentationKey(event.key)) return;
      const marker = readDailyBriefPresentation(settings.accountRef, settings.localDate);
      if (marker.dismissed) { discardDailyBriefAttempt(briefClient); epoch.current += 1; setView(HIDDEN); return; }
      // Another tab delivered, failed or claimed an attempt; re-evaluate without starting automatically.
      const own = currentDailyBriefAttempt(briefClient, settings);
      if (!own) evaluate(settings, false);
      else if (own.outcome && own.outcome.kind !== "ready" && marker.delivered) show(HIDDEN);
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

  useEffect(() => {
    sourceKeyRef.current = sourceKey;
  }, [sourceKey]);

  if (!resolvedClient || view.kind === "hidden" || viewSession !== sessionKey) return null;
  const onDismiss = () => actions.current.dismiss();
  if (view.kind === "loading") return <DailyBriefBubble state="loading" onDismiss={onDismiss} />;
  // Delivered text reflects the facts it was prepared from; changed Timeline facts withdraw it.
  const shown = view.kind === "ready" && view.attempt.sourceKey !== sourceKey ? staleNotice() : view;
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
    return <DailyBriefBubble state="ready" briefing={shown.briefing} travel={travel} onDismiss={onDismiss} plan={plan} />;
  }
  if (shown.kind !== "notice") return null;
  const action = planControls && shown.action === "manage_usage" ? { label: "Manage usage", onClick: planControls.manageUsage }
    : planControls && shown.action === "connect" ? { label: "Continue with ChatGPT", onClick: connectPlan, chatGpt: true } : undefined;
  return (
    <DailyBriefBubble
      state="error"
      message={shown.message}
      action={action}
      onDismiss={onDismiss}
      onRetry={shown.retryLabel ? () => actions.current.retry() : undefined}
      retryLabel={shown.retryLabel}
      retryDisabled={shown.retryAt !== undefined}
    />
  );
}

function expiredNotice(): View {
  return { kind: "notice", message: "This Daily Brief’s timing has expired.", retryLabel: "Get a fresh brief" };
}

function staleNotice(): Extract<View, { kind: "notice" }> {
  return { kind: "notice", message: "Your Timeline changed after this brief was prepared.", retryLabel: "Refresh brief" };
}

function failureNotice(outcome: Extract<DailyBriefOutcome, { kind: "failed" }>): Extract<View, { kind: "notice" }> {
  const retryAt = outcome.retryAfterSeconds ? outcome.settledAt + outcome.retryAfterSeconds * 1000 : undefined;
  const wait = outcome.retryAfterSeconds ? ` Try again in about ${formatWait(outcome.retryAfterSeconds)}.` : " Try again shortly.";
  switch (outcome.code) {
    case "pending":
      return { kind: "notice", message: `Daily Brief is still being prepared.${wait}`, retryLabel: TRY_AGAIN, retryAt };
    case "rate_limited":
      return { kind: "notice", message: `Daily Brief reached its request limit.${wait}`, retryLabel: TRY_AGAIN, retryAt };
    case "timeout":
      return { kind: "notice", message: "Daily Brief took too long to load. Tracking is unaffected.", retryLabel: TRY_AGAIN };
    case "offline":
      return { kind: "notice", message: "You appear to be offline. Try again when you are connected.", retryLabel: TRY_AGAIN };
    case "unauthenticated":
      return { kind: "notice", message: "Sign in again to load today’s Daily Brief." };
    case "context_changed":
    case "context_expired":
      return { kind: "notice", message: "Your Timeline or settings changed while the brief was prepared.", retryLabel: "Get a current brief" };
    case "retry_exhausted":
      return { kind: "notice", message: "Today’s Daily Brief retry limit has been reached. Tracking is unaffected." };
    case "access_denied":
    case "not_configured":
      return { kind: "notice", message: "Daily Brief is turned off or unavailable. Check Settings." };
    case "brief_unavailable":
      return { kind: "notice", message: "Today’s Daily Brief is unavailable.", retryLabel: TRY_AGAIN };
    // Ticket 299 (D27): the Mac's ChatGPT plan could not run the brief. Cadence does not run it another way.
    case "chatgpt_usage_limit":
      return { kind: "notice", message: "ChatGPT usage limit reached. Review your plan or Cadence’s limit in ChatGPT settings.", action: "manage_usage", retryLabel: TRY_AGAIN };
    case "chatgpt_not_eligible":
      return { kind: "notice", message: "Your ChatGPT plan can’t run the Daily Brief. To use Cadence instead, disconnect ChatGPT in Settings." };
    case "chatgpt_reconnect":
      return { kind: "notice", message: "Reconnect ChatGPT to load today’s Daily Brief on your plan.", action: "connect" };
    case "chatgpt_retry_later":
    case "chatgpt_timeout":
    case "chatgpt_advisor_unavailable":
    case "chatgpt_unavailable":
      return { kind: "notice", message: "ChatGPT could not run today’s Daily Brief. Try again later.", retryLabel: TRY_AGAIN };
    default:
      return { kind: "notice", message: outcome.recovery ?? "Cadence could not prepare today’s Daily Brief.", retryLabel: TRY_AGAIN };
  }
}

function formatWait(seconds: number) {
  return seconds < 90 ? `${Math.ceil(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}
