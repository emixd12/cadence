import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DesktopApp, type DesktopScreen } from "./desktop-app";
import { openCalendarSourceUrl } from "./calendar/google-calendar";
import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { travelSourceKey, useTravelContext, type TravelCorrection } from "@/lib/ui/travel";
import { createDesktopTravelClient } from "./travel";
import { createLocalTravelSettingsClient, readLocalTravelSetupPresence } from "./local-travel-settings.service";
import { readMacForegroundLocation } from "./foreground-location";
import { useDesktopGoogleCalendar } from "./calendar/use-google-calendar";
import { useDesktopConnectors } from "./calendar/use-connectors";
import { ConnectorLibrary, ConnectorUnavailable, connectorUnavailableReason } from "@/components/settings/ConnectorLibrary";
import { IcloudCalendarPanel } from "@/components/settings/IcloudCalendarPanel";
import { OutlookCalendarPanel } from "@/components/settings/OutlookCalendarPanel";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { desktopTimelineFreshness } from "./calendar/timeline-freshness";
import { outlookTimelineRange } from "@/lib/ui/connectors";
import { createDesktopDailyBriefClient } from "./daily-brief";
import { TimelineScreen } from "./timeline-screen";
import { BehaviorsScreen } from "./behaviors-screen";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { createLocalCategoryAction } from "./local-category.service";
import { createLocalNoteShortcutStore } from "./local-note-shortcut.service";
import { getNoteShortcutView, listAcceptedNoteShortcuts, manageNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import type { NoteShortcutView } from "@cadence/core/types/note-shortcut";
import { GlobalNoteShortcutControl, type NoteShortcutAction } from "@/components/note-shortcuts/NoteShortcutControls";
import { SettingsScreen } from "./settings-screen";
import { LocalExportScreen } from "./export-screen";
import { hasPendingLocalCommands, localCommand } from "./local-store";
import { DesktopOnboardingGuide } from "./onboarding-guide";
import { DesktopUpdateNotice, DesktopUpdatePanel } from "./desktop-update-panel";
import { desktopUpdater } from "./native-updater";
import { discardUnsavedDesktopDrafts, hasPendingDesktopWrites, hasUnsavedDesktopDrafts } from "./desktop-restart";
import { LocalDatabaseControls } from "./local-database-controls";
import { createLocalTimezoneAction } from "./local-settings.service";
import { reconcileLocalReminders, reminderCoverageView, requestLocalNotificationPermission, retainNativeDeliveryEvents, type LocalReminderResult } from "./local-reminder.service";
import { readNativeEvents } from "./native-spike";
import { createLocalBehaviorActions, createLocalOccurrenceActions, localErrorMessage } from "./local-actions";
import { getLocalBehaviorsPageData } from "./local-behaviors-read.service";
import { loadLocalTimeline } from "./local-timeline.service";
import { latestNotificationOccurrenceId, loadNotificationOccurrence, type NotificationTarget } from "./notification-activation";
import { scrollAfterDesktopNavigation } from "./desktop-navigation";
import { scheduleLocalDayRefresh } from "./desktop-lifecycle";
import { reconcileLocalBehaviorEndDates } from "./local-behavior-lifecycle.service";
import type { AnalyticsSelection } from "@cadence/core/services/analytics";
import "./timeline.css";
import { AccountConflictReview, AccountDisconnectPanel, AccountPanel, AccountSyncPanel, FirstAccountLinkChoice } from "./account/account-panel";
import { DesktopAuth, readDesktopAuthConfig, type DesktopAccountState } from "./account/auth";
import { planAccountSync, synchronizeAccount, synchronizeReviewedAccount, type AccountSyncInputs } from "./account/account-sync";
import { shouldRetryAccountSync, type SyncStatus } from "./sync-engine";
import type { AccountSyncConflict, AccountSyncConflictDecision } from "@cadence/core/resolvers/account-sync.resolver";
import { hasRecognizedLocalData } from "@cadence/core/services/first-account-link";
import { completedFirstLinkState, finishFirstAccountLink, finishReviewedFirstAccountLink, firstLinkFailureBackupPath, recoverRejectedFirstLinkReview, type FirstLinkConflict } from "./account/first-link";

type Bundle = { timeline: Awaited<ReturnType<typeof loadLocalTimeline>>;
  behaviors: Awaited<ReturnType<typeof getLocalBehaviorsPageData>>; hasImportRuns: boolean;
  shortcuts: { global: NoteShortcutView; accepted: Record<string, import("@cadence/core/types/note-shortcut").NoteShortcut[]>; views: Record<string, NoteShortcutView> } };
type SyncCompletion = Readonly<{ status: SyncStatus; localCurrent: boolean }>;
const AVAILABLE_SCREENS: DesktopScreen[] = ["timeline", "behaviors", "export", "settings"];

export function Product() {
  const [activeScreen, setActiveScreen] = useState<DesktopScreen>("timeline");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<LocalReminderResult | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const [guideRequest, setGuideRequest] = useState(0);
  const [restartBlocked, setRestartBlocked] = useState(false);
  const [restartError, setRestartError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    void desktopUpdater.start();
    return () => desktopUpdater.stop();
  }, []);
  const [account, setAccount] = useState<DesktopAccountState>({ status: "local" });
  const [accountBusy, setAccountBusy] = useState(false);
  const [firstLink, setFirstLink] = useState<{ recognized: boolean; complete?: boolean; backupPath?: string; error?: string } | null>(null);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "offline" });
  const [conflictReview, setConflictReview] = useState<{ inputs: AccountSyncInputs; conflicts: readonly AccountSyncConflict[]; firstLink?: FirstLinkConflict; error?: string } | null>(null);
  const [disconnectResult, setDisconnectResult] = useState("");
  const [disconnectError, setDisconnectError] = useState("");
  const [syncRequest, setSyncRequest] = useState(0);
  const syncRunning = useRef(false);
  const syncPending = useRef(false);
  const syncWaiters = useRef<Array<(completion: SyncCompletion) => void>>([]);
  const syncRetry = useRef(0);
  const syncRetryTimer = useRef<number | null>(null);
  const auth = useRef<DesktopAuth | null>(null);
  const [travelCorrections, setTravelCorrections] = useState<{ accountId: string | null; items: readonly TravelCorrection[] }>({ accountId: null, items: [] });
  const [calendarClient, setCalendarClient] = useState<ReturnType<DesktopAuth["accountClient"]> | null>(null);
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget | null>(null);
  const [navigationRequest, setNavigationRequest] = useState<{ anchor?: string } | null>(null);
  const activation = useRef<{ occurrenceId: string; requestKey: number } | null>(null);
  const activationSequence = useRef(0);
  const reminderRevision = useRef(0);
  const archiveLifecycle = useRef<Promise<void>>(Promise.resolve());
  const parameters = useRef<{ days: number; analytics: AnalyticsSelection }>({ days: 7, analytics: {} });
  const revision = useRef(0);
  const refreshRunning = useRef(false);
  const refreshWaiters = useRef<Array<(success: boolean) => void>>([]);
  const syncAfterRefresh = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    if (navigationRequest) return scrollAfterDesktopNavigation(navigationRequest.anchor);
  }, [navigationRequest]);
  const refreshReminders = useCallback((requestPermission = false) => {
    if (!isTauri()) return;
    const current = ++reminderRevision.current;
    setReminderBusy(true);
    setReminderError("");
    setReminders((previous) => previous ? { ...previous, state: { ...previous.state, coverage: null } } : null);
    void (requestPermission ? requestLocalNotificationPermission() : reconcileLocalReminders()).then((result) => {
      if (mounted.current && current === reminderRevision.current) setReminders(result);
    }).catch((failure) => {
      if (mounted.current && current === reminderRevision.current) setReminderError(localErrorMessage(failure));
    }).finally(() => {
      if (mounted.current && current === reminderRevision.current) setReminderBusy(false);
    });
  }, []);
  const refreshScreen = useCallback((): Promise<boolean> => {
    const completion = new Promise<boolean>((resolve) => refreshWaiters.current.push(resolve));
    revision.current += 1;
    if (!isTauri()) {
      setLoading(false);
      refreshWaiters.current.splice(0).forEach((resolve) => resolve(true));
      return completion;
    }
    archiveLifecycle.current = reconcileLocalBehaviorEndDates(Temporal.Now.instant())
      .then(() => refreshReminders())
      .catch((failure) => {
        if (mounted.current) setReminderError(localErrorMessage(failure));
      });
    if (refreshRunning.current) return completion;
    refreshRunning.current = true;
    void (async () => {
      // Keep one running read and one latest request, including edits arriving during a read.
      let current: number;
      let successful = false;
      do {
        current = revision.current;
        const requestedActivation = activation.current;
        const now = Temporal.Now.instant();
        try {
          await archiveLifecycle.current;
          const timeline = await loadLocalTimeline(parameters.current.days, now);
          if (!mounted.current || current !== revision.current) continue;
          const [behaviors, imports, global, accepted, behaviorViews] = await Promise.all([
            getLocalBehaviorsPageData(timeline.profile, { ...parameters.current.analytics, now }),
            localCommand("readImportRuns", { profileId: timeline.profile.id, limit: 1 }),
            getNoteShortcutView(createLocalNoteShortcutStore(timeline.profile.id), null, now),
            listAcceptedNoteShortcuts(createLocalNoteShortcutStore(timeline.profile.id)),
            Promise.all(timeline.behaviors.map(async (behavior) => [behavior.id, await getNoteShortcutView(createLocalNoteShortcutStore(timeline.profile.id), behavior.id, now)] as const)),
          ]);
          if (requestedActivation) {
            let target: NotificationTarget;
            try {
              const occurrence = await loadNotificationOccurrence({ occurrenceId: requestedActivation.occurrenceId,
                profile: timeline.profile, behaviors: timeline.behaviors, now });
              target = occurrence ? { requestKey: requestedActivation.requestKey, status: "available", occurrence }
                : { requestKey: requestedActivation.requestKey, status: "unavailable" };
            } catch (failure) {
              target = { requestKey: requestedActivation.requestKey, status: "error", message: localErrorMessage(failure) };
            }
            if (mounted.current && current === revision.current && activation.current?.requestKey === requestedActivation.requestKey) setNotificationTarget(target);
          }
          if (mounted.current && current === revision.current) {
            setBundle({ timeline, behaviors, hasImportRuns: imports.length > 0, shortcuts: { global, accepted, views: Object.fromEntries(behaviorViews) } });
            setError("");
            successful = true;
            if (syncAfterRefresh.current) {
              syncAfterRefresh.current = false;
              setSyncRequest((value) => value + 1);
            }
          }
        } catch (failure) {
          if (mounted.current && current === revision.current) {
            setError(localErrorMessage(failure));
            successful = false;
            if (requestedActivation && activation.current?.requestKey === requestedActivation.requestKey) setNotificationTarget({ requestKey: requestedActivation.requestKey,
              status: "error", message: localErrorMessage(failure) });
          }
        } finally {
          if (mounted.current && current === revision.current) setLoading(false);
        }
      } while (mounted.current && current !== revision.current);
      refreshRunning.current = false;
      refreshWaiters.current.splice(0).forEach((resolve) => resolve(successful));
    })();
    return completion;
  }, [refreshReminders]);
  const refresh = useCallback(() => {
    syncAfterRefresh.current = true;
    void refreshScreen();
  }, [refreshScreen]);
  useEffect(() => {
    mounted.current = true;
    const browserRefresh = !isTauri() ? window.setTimeout(refresh, 0) : undefined;
    let unlisten: (() => void) | undefined;
    const nativeChanged = async () => {
      try {
        const events = await readNativeEvents();
        if (!mounted.current) return;
        retainNativeDeliveryEvents(events);
        if (events.length) void desktopUpdater.checkOverdue();
        const occurrenceId = latestNotificationOccurrenceId(events);
        if (occurrenceId) {
          const requestKey = ++activationSequence.current;
          activation.current = { occurrenceId, requestKey };
          setNotificationTarget({ requestKey, status: "loading" });
          setNavigationRequest(null);
          setActiveScreen("timeline");
        }
        return events.length > 0;
      } catch (failure) { if (mounted.current) setReminderError(localErrorMessage(failure)); }
      return false;
    };
    if (isTauri()) void listen("desktop-native-event", () => {
      void nativeChanged().then((changed) => { if (mounted.current && changed) refresh(); });
    }).then(async (stop) => {
      if (!mounted.current) { stop(); return; }
      unlisten = stop;
      await nativeChanged();
      if (mounted.current) refresh();
    }).catch((failure) => { if (mounted.current) { refresh(); setReminderError(localErrorMessage(failure)); } });
    return () => { mounted.current = false; unlisten?.(); window.clearTimeout(browserRefresh); };
  }, [refresh]);
  useEffect(() => {
    const config = readDesktopAuthConfig();
    if (!isTauri() || !config) return;
    let active = true;
    const service = new DesktopAuth(config, (state) => { if (active) { setAccount(state); setCalendarClient(state.status === "linked" ? service.accountClient() : null); } });
    auth.current = service;
    let stop: (() => void) | undefined;
    void service.initialize().then((value) => { if (active) stop = value; else value(); }).catch(() => { if (active) setAccount({ status: "error", message: "The saved account session could not be read." }); });
    return () => { active = false; auth.current = null; stop?.(); void service.dispose(); };
  }, []);
  const runAccount = (action: () => Promise<void>) => {
    setAccountBusy(true);
    void action().catch((failure) => setAccount({ status: "error", message: localErrorMessage(failure) })).finally(() => setAccountBusy(false));
  };
  const runFirstLink = (choice: "import" | "ignore" | "hydrate") => {
    if (account.status !== "linked" || !profile || !auth.current) return;
    setAccountBusy(true); setFirstLink((value) => value ? { ...value, error: undefined } : value);
    void finishFirstAccountLink({ client: auth.current.accountClient(), profile, hostedUserId: account.userId, choice }).then((result) => {
      if (result.status === "conflict") {
        if (result.inputs && result.conflicts && result.attempt) setConflictReview({ inputs: result.inputs, conflicts: result.conflicts, firstLink: { inputs: result.inputs, conflicts: result.conflicts, attempt: result.attempt, backupPath: result.backupPath } });
        setFirstLink({ recognized: true, error: `Conflict review is required for ${result.count} item${result.count === 1 ? "" : "s"}.` });
      }
      else { setFirstLink({ recognized: false, complete: true, backupPath: result.backupPath ?? undefined }); setSyncReady(true); refresh(); }
    }).catch((failure) => setFirstLink((value) => ({ recognized: value?.recognized ?? true, backupPath: firstLinkFailureBackupPath(failure) ?? value?.backupPath, error: localErrorMessage(failure) }))).finally(() => setAccountBusy(false));
  };
  useEffect(() => {
    desktopUpdater.setRestartGuard(() => !syncRunning.current && !accountBusy && !hasPendingLocalCommands() && !hasPendingDesktopWrites() && !hasUnsavedDesktopDrafts());
    return () => desktopUpdater.setRestartGuard(undefined);
  }, [accountBusy]);
  const restartUpdate = (discard = false) => {
    setRestartError("");
    if (syncRunning.current || accountBusy || hasPendingLocalCommands() || hasPendingDesktopWrites()) {
      setRestartError("Cadence is still saving or synchronizing. Try Restart again in a moment, or quit and reopen Cadence to finish the update.");
      return;
    }
    if (discard && !discardUnsavedDesktopDrafts()) return;
    if (hasUnsavedDesktopDrafts()) { setRestartBlocked(true); return; }
    setRestartBlocked(false);
    void desktopUpdater.restart();
  };
  const restartActions = { onRestart: () => restartUpdate(), onDiscardAndRestart: () => restartUpdate(true),
    onCancelRestart: () => setRestartBlocked(false), restartBlocked, restartError };
  const profile = bundle?.timeline.profile;
  useEffect(() => {
    if (!profile || !auth.current) { setFirstLink(null); setSyncReady(false); return; }
    let active = true;
    const service = auth.current;
    if (account.status !== "linked") {
      void service.firstLinkBaseline().then((baseline) => {
        if (!active) return;
        setFirstLink(null);
        setSyncReady(Boolean(baseline));
        if (baseline && account.status !== "waiting") setSyncStatus({ state: "revoked" });
      }).catch(() => { if (active) setSyncReady(false); });
      return () => { active = false; };
    }
    void Promise.all([service.firstLinkBaseline(), localCommand("readImportSnapshot", { profileId: profile.id })]).then(([baseline, snapshot]) => {
      if (!active) return;
      if (baseline) { setSyncReady(true); return; }
      const recognized = hasRecognizedLocalData(snapshot);
      setFirstLink({ recognized });
      if (!recognized) runFirstLink("hydrate");
    }).catch((failure) => { if (active) setFirstLink({ recognized: true, error: localErrorMessage(failure) }); });
    return () => { active = false; };
  // The authenticated user ID is the stable first-link identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.status === "linked" ? account.userId : null, profile?.id]);
  const profileId = profile?.id;
  const accountUserId = account.status === "linked" ? account.userId : null;
  const dailyBriefClient = useMemo(() => calendarClient && accountUserId ? createDesktopDailyBriefClient(calendarClient) : null, [calendarClient, accountUserId]);
  const travelSettingsClient = useMemo(() => {
    const local = createLocalTravelSettingsClient();
    return { load: local.load, save: async (value: Parameters<typeof local.save>[0]) => {
      const saved = await local.save(value);
      setSyncRequest((previous) => previous + 1);
      return saved;
    } };
  }, []);
  const travelClient = useMemo(() => calendarClient && accountUserId ? createDesktopTravelClient(calendarClient) : null, [calendarClient, accountUserId]);
  const calendarRange = {
    startLocalDate: bundle?.timeline.timeline.todayLocalDate ?? "1970-01-01",
    endLocalDate: bundle?.timeline.timeline.daySections.at(-1)?.localDate ?? "1970-01-01",
  };
  const calendar = useDesktopGoogleCalendar({
    client: calendarClient,
    screen: activeScreen === "timeline" || activeScreen === "settings" ? activeScreen : null,
    accountId: accountUserId, timezone: profile?.timezone ?? "America/New_York", range: calendarRange,
    enabled: isTauri() && Boolean(bundle && accountUserId) && (activeScreen === "timeline" || activeScreen === "settings"),
  });
  const connectors = useDesktopConnectors({
    client: calendarClient,
    screen: activeScreen === "timeline" || activeScreen === "settings" ? activeScreen : null,
    accountId: accountUserId, timezone: profile?.timezone ?? "America/New_York",
    todayLocalDate: calendarRange.startLocalDate, lastLocalDate: calendarRange.endLocalDate,
    enabled: isTauri() && Boolean(bundle && accountUserId) && (activeScreen === "timeline" || activeScreen === "settings"),
  });
  const outlookTimeline = connectors.outlook;
  const icloudTimeline = connectors.icloud;
  const icloudEvents = icloudTimeline.snapshot?.events.filter((event) => !icloudTimeline.hiddenCalendarIds.includes(event.calendarId)
    && (icloudTimeline.showAllDay || event.kind !== "all_day")) ?? [];
  const outlookEvents = outlookTimeline.snapshot?.events.filter((event) => !outlookTimeline.hiddenCalendarIds.includes(event.calendarId)
    && (outlookTimeline.showAllDay || event.kind !== "all_day")) ?? [];
  const currentTravelCorrections = useMemo(() => (travelCorrections.accountId === accountUserId ? travelCorrections.items : []).filter((correction) => calendar.snapshot?.events.some((event) => event.id === correction.eventId && (event.revision.providerEtag ?? event.revision.providerUpdatedAt) === correction.revision)), [travelCorrections, calendar.snapshot, accountUserId]);
  const visibleCalendarEvents = calendar.preferences?.visible ? calendar.snapshot?.events.filter((event) =>
    !calendar.preferences!.hiddenCalendarIds.includes(event.calendarId)
    && (calendar.preferences!.showAllDay || event.kind !== "all_day")) ?? [] : [];
  const travel = useTravelContext({ enabled: activeScreen === "timeline" && syncReady && syncStatus.state === "current",
    accountId: accountUserId, localDate: calendarRange.startLocalDate, client: travelClient, corrections: currentTravelCorrections,
    sourceKey: travelSourceKey(visibleCalendarEvents, bundle?.timeline.timeline ?? { daySections: [], durationEstimates: {} },
      bundle?.timeline.behaviors.map((behavior) => ({ id: behavior.id, whereKind: behavior.where_kind ?? null, locationText: behavior.location_text ?? null, updatedAt: behavior.updated_at })) ?? []) });
  const calendarContext = {
    travelMessage: travel.message,
    travelStatus: travel,
    onTravelCorrection: travel.view ? (correction: TravelCorrection) => setTravelCorrections((previous) => ({ accountId: accountUserId, items: [...(previous.accountId === accountUserId ? previous.items : []).filter((item) => item.eventId !== correction.eventId).slice(-7), correction] })) : undefined,
    travel: travel.view?.evidence, travelMode: travel.view?.mode, navigationPreference: "apple_maps" as const,
    // Travel and its brief guidance stay on Google events; Outlook and iCloud add schedule context only.
    events: [...visibleCalendarEvents, ...outlookEvents, ...icloudEvents],
    ...desktopTimelineFreshness({ snapshot: calendar.snapshot, stale: calendar.stale, label: calendar.label, error: calendar.error }, outlookTimeline, icloudTimeline),
    recordedActivity: connectors.hevy,
  };
  const syncAccount = useCallback((): Promise<SyncCompletion> => {
    if (!syncReady || !accountUserId || !profileId || !auth.current) {
      return Promise.resolve({ status: { state: "offline" }, localCurrent: false });
    }
    if (conflictReview) {
      return Promise.resolve({ status: { state: "conflict", count: conflictReview.conflicts.length }, localCurrent: false });
    }
    const completion = new Promise<SyncCompletion>((resolve) => syncWaiters.current.push(resolve));
    if (syncRunning.current) { syncPending.current = true; return completion; }
    syncRunning.current = true;
    syncPending.current = false;
    if (syncRetryTimer.current !== null) { window.clearTimeout(syncRetryTimer.current); syncRetryTimer.current = null; }
    setSyncStatus({ state: "syncing" });
    let completedStatus: SyncStatus = { state: "failed", message: "Synchronization did not complete." };
    let localCurrent = false;
    void synchronizeAccount(profileId, auth.current.accountClient()).then(async (status) => {
      completedStatus = status;
      if (!mounted.current) return;
      setSyncStatus(status);
      if (status.state === "current") {
        syncRetry.current = 0;
        setConflictReview(null);
        localCurrent = await refreshScreen();
      }
      else if (status.state === "conflict") {
        syncRetry.current = 0;
        void planAccountSync(profileId, auth.current!.accountClient()).then(({ inputs, plan }) => {
          if (mounted.current) setConflictReview({ inputs, conflicts: plan.conflicts });
        }).catch((failure) => { if (mounted.current) setSyncStatus({ state: "failed", message: localErrorMessage(failure) }); });
      }
      else if (shouldRetryAccountSync(status, syncRetry.current)) {
        const attempt = syncRetry.current++;
        const delay = Math.min(30_000, 1_000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        syncRetryTimer.current = window.setTimeout(() => { syncRetryTimer.current = null; setSyncRequest((value) => value + 1); }, delay);
      }
    }).catch((failure) => {
      completedStatus = { state: "failed", message: localErrorMessage(failure) };
      if (mounted.current) setSyncStatus(completedStatus);
    }).finally(() => {
      syncRunning.current = false;
      if (completedStatus.state === "current" && syncPending.current && mounted.current) {
        syncPending.current = false;
        setSyncRequest((value) => value + 1);
        return;
      }
      syncPending.current = false;
      const completed = { status: completedStatus, localCurrent };
      syncWaiters.current.splice(0).forEach((resolve) => resolve(completed));
    });
    return completion;
  }, [accountUserId, conflictReview, profileId, refreshScreen, syncReady]);
  const refreshCalendar = calendar.refresh;
  const refreshConnectors = connectors.refresh;
  const reloadTimeline = useCallback(async () => {
    const synced = accountUserId ? await syncAccount() : null;
    const accountCurrent = synced ? synced.status.state === "current" : true;
    const cadenceCurrent = synced?.localCurrent || await refreshScreen();
    const [calendarCurrent, connectorsCurrent] = await Promise.all([refreshCalendar("manual"), refreshConnectors("manual")]);
    return accountCurrent && cadenceCurrent && calendarCurrent && connectorsCurrent;
  }, [accountUserId, refreshCalendar, refreshConnectors, refreshScreen, syncAccount]);
  useEffect(() => {
    if (!syncReady) return;
    const trigger = () => syncAccount();
    window.addEventListener("online", trigger);
    return () => { window.removeEventListener("online", trigger); if (syncRetryTimer.current !== null) window.clearTimeout(syncRetryTimer.current); };
  }, [syncAccount, syncReady]);
  useEffect(() => { if (syncReady) syncAccount(); }, [syncAccount, syncReady, syncRequest]);
  useEffect(() => {
    if (profile?.timezone) return scheduleLocalDayRefresh(profile.timezone, refresh);
  }, [profile?.timezone, refresh]);
  /* eslint-disable react-hooks/refs -- These factories only capture refresh; event callbacks read its refs after render. */
  const occurrenceActions = useMemo(() => profile ? createLocalOccurrenceActions(profile.id, () => refresh()) : null, [profile, refresh]);
  const behaviorActions = useMemo(() => profile ? createLocalBehaviorActions(profile, () => refresh()) : null, [profile, refresh]);
  const categoryAction = useMemo(() => createLocalCategoryAction(() => refresh()), [refresh]);
  const timezoneAction = useMemo(() => createLocalTimezoneAction(() => refresh()), [refresh]);
  const noteShortcutAction: NoteShortcutAction = async (behaviorId, command, expectedRevision) => {
    if (!profile) return { status: "error", message: "The local profile is not ready." };
    try {
      const store = createLocalNoteShortcutStore(profile.id);
      const now = Temporal.Now.instant();
      await manageNoteShortcuts(store, { behaviorId, command, expectedRevision, now });
      const view = await getNoteShortcutView(store, behaviorId, now);
      refresh();
      return { status: "success", message: noteShortcutMessage(command.operation, view), view };
    } catch (failure) {
      return { status: "error", message: localErrorMessage(failure) };
    }
  };
  /* eslint-enable react-hooks/refs */
  const coverage = reminders ? reminderCoverageView(reminders.state) : null;
  const permission = reminders?.permission ?? "checking";
  const navigate = (screen: DesktopScreen, anchor?: string) => {
    if (screen !== "timeline") setTravelCorrections({ accountId: null, items: [] });
    activation.current = null;
    setNotificationTarget(null);
    setActiveScreen(screen);
    setNavigationRequest({ anchor });
  };
  const accountControls = <><AccountPanel state={account} configured={readDesktopAuthConfig() !== null} connected={syncReady} busy={accountBusy}
    onSignIn={() => auth.current && runAccount(() => auth.current!.begin())}
    onCancel={() => auth.current && runAccount(() => auth.current!.cancel())} />
    {firstLink ? <FirstAccountLinkChoice recognized={firstLink.recognized} complete={firstLink.complete} busy={accountBusy} backupPath={firstLink.backupPath} error={firstLink.error}
      onImport={() => runFirstLink("import")} onIgnore={() => runFirstLink("ignore")}
      onCancel={() => auth.current && runAccount(() => auth.current!.cancelLink())} /> : null}
    {syncReady ? <AccountSyncPanel status={syncStatus} busy={accountBusy || syncStatus.state === "syncing"} onSync={syncAccount}
      onUpdate={() => { document.getElementById("app-updates")?.focus(); document.getElementById("app-updates")?.scrollIntoView({ block: "start" }); }}
      onReconnect={() => { if (!auth.current) return; setSyncStatus({ state: "revoked" }); runAccount(() => auth.current!.reconnect()); }} /> : null}</>;

  const resolveConflicts = (decisions: readonly AccountSyncConflictDecision[]) => {
    if (!conflictReview || !profile || !auth.current) return;
    setAccountBusy(true); setConflictReview((value) => value ? { ...value, error: undefined } : value);
    const firstLinkReview = conflictReview.firstLink;
    const reviewed = firstLinkReview
      ? finishReviewedFirstAccountLink({ client: auth.current.accountClient(), profileId: profile.id, reviewed: firstLinkReview, decisions })
          .then((result): SyncStatus => {
            const completion = completedFirstLinkState(result);
            setFirstLink(completion.firstLink);
            setSyncReady(completion.syncReady);
            return { state: "current", completedAt: Temporal.Now.instant().toString() };
          })
      : synchronizeReviewedAccount(profile.id, auth.current.accountClient(), conflictReview.inputs, decisions);
    void reviewed.then((status) => {
      setSyncStatus(status);
      if (status.state === "current") { setConflictReview(null); refreshScreen(); }
      else if (status.state === "failed") setConflictReview((value) => value ? { ...value, error: status.message } : value);
    }).catch((failure) => {
      if (firstLinkReview) {
        setConflictReview(null);
        setFirstLink(recoverRejectedFirstLinkReview(firstLinkReview, localErrorMessage(failure)));
      } else setConflictReview((value) => value ? { ...value, error: localErrorMessage(failure) } : value);
    }).finally(() => setAccountBusy(false));
  };
  const disconnect = (mode: "keep" | "remove") => {
    if (!auth.current) return;
    setAccountBusy(true); setDisconnectError(""); setDisconnectResult("");
    void auth.current.disconnect(mode).then((result) => {
      setSyncReady(false); setConflictReview(null); setSyncStatus({ state: "offline" });
      setDisconnectResult(mode === "keep" ? `Local copy kept at ${result.databasePath}` : `Account data removed. Safety backup: ${result.backupPath}. Fresh local database: ${result.databasePath}`);
      refresh();
    }).catch((failure) => setDisconnectError(localErrorMessage(failure))).finally(() => setAccountBusy(false));
  };
  const completeAccountControls = <>{accountControls}
    {conflictReview ? <AccountConflictReview conflicts={conflictReview.conflicts} busy={accountBusy} error={conflictReview.error} onResolve={resolveConflicts} /> : null}
    {account.status === "linked" || syncReady || disconnectResult ? <AccountDisconnectPanel busy={accountBusy} result={disconnectResult} error={disconnectError} onDisconnect={disconnect} /> : null}</>;

  return <DesktopApp account={account} activeScreen={activeScreen} onNavigate={navigate} availableScreens={AVAILABLE_SCREENS} conflictCount={conflictReview?.conflicts.length ?? 0}>
    {!isTauri() ? <div className="p-8"><h1 className="text-3xl font-bold">Open Cadence on your Mac</h1>
      <p className="mt-4">Local tracking uses the desktop app’s SQLite database. This browser preview cannot read or change it.</p></div> : null}
    <DesktopUpdateNotice required={syncStatus.state === "update_required"} {...restartActions} />
    {loading ? <p role="status" className="p-8">Opening local tracking data…</p> : null}
    {error ? <div role="alert" className="m-6 border border-line p-4"><p>{error}</p>
      <button className="product-action product-action-primary mt-3" onClick={refresh}>Try again</button></div> : null}
    {bundle && occurrenceActions && behaviorActions ? <>
      {activeScreen === "timeline" ? <DesktopOnboardingGuide key={guideRequest} forceOpen={guideRequest > 0} onDismiss={() => setGuideRequest(0)}
        hasAnyBehavior={bundle.timeline.behaviors.length > 0} hasImportRuns={bundle.hasImportRuns} currentTimezone={bundle.timeline.profile.timezone}
        permission={permission} coverage={coverage} onNavigate={navigate} availableScreens={AVAILABLE_SCREENS}
        loadTravelSetup={readLocalTravelSetupPresence} readTravelRoutingConfigured={travelClient?.configured ?? null} /> : null}
      {activeScreen === "timeline" ? <TimelineScreen timeline={bundle.timeline.timeline} {...occurrenceActions}
        shortcutsByBehavior={bundle.shortcuts.accepted} dayProgress={calendarContext}
        notificationTarget={notificationTarget}
        dailyBriefClient={dailyBriefClient}
        dailyBriefSessionKey={accountUserId ?? "local"}
        onRefresh={refresh} onReload={reloadTimeline} onShowMore={(days) => { parameters.current.days = days; void refreshScreen(); }} /> : null}
      {activeScreen === "behaviors" ? <BehaviorsScreen {...bundle.behaviors.behaviors} analytics={bundle.behaviors.analytics}
        {...occurrenceActions} {...behaviorActions} onRefresh={refresh}
        noteShortcutViews={bundle.shortcuts.views} noteShortcutAction={noteShortcutAction}
        onNavigateReview={(selection) => { parameters.current.analytics = selection; refreshScreen(); }} /> : null}
      {activeScreen === "settings" ? <SettingsScreen currentTimezone={bundle.timeline.profile.timezone} accountConnected={syncReady}
        noteShortcutControls={<GlobalNoteShortcutControl view={bundle.shortcuts.global} action={noteShortcutAction} />}
        categoryControls={<CategoryPanel categories={bundle.timeline.categories}
          assignments={bundle.timeline.behaviors.map((behavior) => ({ id: behavior.id, categoryId: behavior.category_id, active: behavior.active, updatedAt: behavior.updated_at }))} action={categoryAction} />}
        accountControls={completeAccountControls}
        calendarControls={<ConnectorLibrary sources={[
          { id: "google_calendar", content: calendar.coordinator ? <GoogleCalendarPanel key={accountUserId ?? "local"} coordinator={calendar.coordinator} refreshRange={calendarRange} refreshVersion={calendar.panelVersion} wrongAccount={calendar.wrongAccount} openExternalUrl={openCalendarSourceUrl} nested />
            : <ConnectorUnavailable id="google_calendar" reason={calendar.label} /> },
          { id: "outlook_calendar", content: connectors.outlookCoordinator ? <OutlookCalendarPanel key={`outlook-${accountUserId}`} coordinator={connectors.outlookCoordinator}
            refreshRange={outlookTimelineRange(calendarRange.startLocalDate, calendarRange.endLocalDate, profile?.timezone ?? "America/New_York")}
            callbackMessage={connectors.outlookMessage} refreshVersion={connectors.panelVersion} />
            : <ConnectorUnavailable id="outlook_calendar" reason={connectorUnavailableReason("Outlook Calendar", connectors.unavailableReason)} /> },
          { id: "icloud_calendar", content: connectors.icloudCoordinator ? <IcloudCalendarPanel key={`icloud-${accountUserId}`} coordinator={connectors.icloudCoordinator}
            refreshRange={outlookTimelineRange(calendarRange.startLocalDate, calendarRange.endLocalDate, profile?.timezone ?? "America/New_York")} />
            : <ConnectorUnavailable id="icloud_calendar" reason={connectorUnavailableReason("iCloud Calendar", connectors.unavailableReason)} /> },
          { id: "hevy", content: connectors.hevyCoordinator ? <HevyPanel key={`hevy-${accountUserId}`} coordinator={connectors.hevyCoordinator}
            localDate={calendarRange.startLocalDate} timezone={profile?.timezone ?? "America/New_York"} refreshVersion={connectors.panelVersion} />
            : <ConnectorUnavailable id="hevy" reason={connectorUnavailableReason("Hevy", connectors.unavailableReason)} /> },
        ]} />}
        dailyBriefControls={<DailyBriefSettingsPanel key={accountUserId ?? "local"} client={dailyBriefClient} desktop />}
        travelControls={<TravelSettingsPanel key={`travel-${accountUserId ?? "local"}`} client={travelSettingsClient} readLocation={readMacForegroundLocation} desktop />}
        updates={<div id="app-updates" tabIndex={-1} className="scroll-mt-20"><DesktopUpdatePanel {...restartActions} /></div>}
        databaseControls={<LocalDatabaseControls onRestored={refresh} />}
        updateTimezoneAction={timezoneAction} permission={permission} coverage={coverage}
        busy={reminderBusy} error={reminderError} onRequestPermission={() => refreshReminders(true)}
        onReconcile={() => refreshReminders()} onShowOnboarding={() => { setGuideRequest((value) => value + 1); navigate("timeline"); }} /> : null}
      {activeScreen === "export" ? <LocalExportScreen onChanged={refresh} /> : null}
    </> : null}
  </DesktopApp>;
}

function noteShortcutMessage(operation: string, view: NoteShortcutView): string {
  if (operation === "analyze") return view.entries.some((entry) => entry.status === "proposed")
    ? "Repeated Notes checked."
    : "No new shortcuts found. Matching needs the same Note on three eligible Occurrences.";
  if (operation === "remove") return "Note shortcut removed.";
  if (operation === "dismiss") return "Note shortcut dismissed.";
  if (operation === "accept") return "Note shortcut accepted.";
  if (operation === "edit") return "Note shortcut saved.";
  return "Note shortcut setting saved.";
}
