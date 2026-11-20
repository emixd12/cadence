import { LinkProvider, RefreshProvider, type RuntimeLinkProps } from "@cadence/ui/runtime";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { NeedsDecisionDialog } from "@/components/timeline/NeedsDecisionDialog";
import { openCalendarSourceUrl } from "./calendar/google-calendar";
import { DayProgressTimeline, type DayProgressContext } from "@/components/timeline/DayProgressTimeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { OccurrenceMarkDetailsProvider, type OccurrenceMarkDetailActions } from "@/components/timeline/OccurrenceMarkDetails";
import { useTimelineWheelReload } from "@/lib/ui/timeline-wheel-reload";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { AdvisorTimelineFrame } from "@/components/advisor/AdvisorTimelineFrame";
import type { NotificationTarget } from "./notification-activation";
import type { DesktopScreen } from "./desktop-app";
import type {
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineView,
} from "@/lib/types/timeline";

export type TimelineScreenProps = Readonly<{
  timeline: TimelineView;
  dayProgress?: DayProgressContext;
  statusAction: OccurrenceFormAction;
  noteAction: OccurrenceFormAction;
  dayNoteAction?: OccurrenceFormAction;
  startTimeTrackingAction: TimeTrackingFormAction;
  stopTimeTrackingAction: TimeTrackingFormAction;
  resetTimeTrackingAction: TimeTrackingFormAction;
  onRefresh: () => void;
  onReload?: () => Promise<boolean>;
  onShowMore: (days: number) => void;
  notificationTarget?: NotificationTarget | null;
  shortcutsByBehavior?: Record<string, NoteShortcut[]>;
  dailyBriefClient?: DailyBriefClient | null;
  dailyBriefSessionKey?: string;
  // Shared links on the Timeline (the archive notice) switch desktop screens instead of loading a URL.
  onNavigate?: (screen: DesktopScreen, anchor?: string) => void;
  /** Advisor plan 4G: the "Done at" and "Why?" lines after a mark. */
  markDetailActions?: OccurrenceMarkDetailActions;
}>;

type NavigateScreen = (screen: DesktopScreen, anchor?: string) => void;
const ScreenNavigation = createContext<NavigateScreen | undefined>(undefined);
const DESKTOP_SCREENS: Readonly<Record<string, DesktopScreen>> = {
  "/timeline": "timeline", "/behaviors": "behaviors", "/export": "export", "/settings": "settings",
};

function desktopScreenForHref(href: string): { screen: DesktopScreen; anchor?: string } | null {
  const url = new URL(href, "https://cadence.local");
  const screen = url.origin === "https://cadence.local" ? DESKTOP_SCREENS[url.pathname] : undefined;
  return screen ? { screen, anchor: url.hash.slice(1) || undefined } : null;
}

function DesktopScreenLink({ href, scroll: _scroll, onClick, ...props }: RuntimeLinkProps) {
  void _scroll;
  const navigate = useContext(ScreenNavigation);
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // The webview has no routes; never let it load the href.
        event.preventDefault();
        const target = desktopScreenForHref(href);
        if (target) navigate?.(target.screen, target.anchor);
      }}
    />
  );
}

export function TimelineScreen({
  timeline,
  dayProgress,
  onRefresh,
  onReload,
  onShowMore,
  notificationTarget,
  shortcutsByBehavior = {},
  dailyBriefClient,
  dailyBriefSessionKey,
  onNavigate,
  markDetailActions,
  ...actions
}: TimelineScreenProps) {
  const nextFutureDays = timeline.nextFutureDays;
  const rootRef = useRef<HTMLDivElement>(null);
  const reloadInFlightRef = useRef(false);
  const resultTimerRef = useRef<number | null>(null);
  const [reloadMessage, setReloadMessage] = useState("");
  const targetOccurrence = notificationTarget?.status === "available" ? notificationTarget.occurrence : null;
  const targetInFeed = !!targetOccurrence && timeline.daySections.some((section) =>
    section.occurrences.some((occurrence) => occurrence.id === targetOccurrence.id));
  const targetId = targetOccurrence?.id;
  const targetRequest = notificationTarget?.requestKey;
  const targetStatus = notificationTarget?.status;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !targetStatus || targetStatus === "loading") return;
    const row = targetId ? Array.from(root.querySelectorAll<HTMLElement>("[data-occurrence-id]"))
      .find((element) => element.dataset.occurrenceId === targetId) : undefined;
    const details = row?.querySelector("details");
    if (details) details.open = true;
    const focusTarget = row?.querySelector<HTMLElement>("summary")
      ?? root.querySelector<HTMLElement>("[data-notification-result]");
    focusTarget?.focus({ preventScroll: true });
    (row ?? focusTarget)?.scrollIntoView({ block: "center" });
  }, [targetId, targetRequest, targetStatus, targetInFeed]);

  const reload = useCallback(() => {
    if (!onReload || reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    setReloadMessage("Reloading Cadence and connectors");
    void onReload().then((success) => {
      setReloadMessage(success
        ? "Cadence and connectors reloaded."
        : "Reload incomplete. Cadence or connector data may be stale.");
    }).catch(() => {
      setReloadMessage("Reload incomplete. Cadence or connector data may be stale.");
    }).finally(() => {
      reloadInFlightRef.current = false;
      if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = window.setTimeout(() => setReloadMessage(""), 2_400);
    });
  }, [onReload]);

  useTimelineWheelReload({
    rootRef,
    reloadInFlightRef,
    onReload: reload,
    enabled: Boolean(onReload),
  });

  useEffect(() => () => {
    if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
  }, []);

  return (
    <ScreenNavigation.Provider value={onNavigate}>
    <LinkProvider component={DesktopScreenLink}>
    <RefreshProvider onRefresh={onRefresh}>
    <MarkDetails actions={markDetailActions} timezone={timeline.timezone}>
      <div ref={rootRef} className="flex w-full flex-col">
        <h1 className="sr-only">Timeline</h1>
        {reloadMessage ? (
          <p role="status" aria-live="polite"
            className="pointer-events-none fixed left-1/2 top-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] z-30 -translate-x-1/2 border border-line bg-background px-3 py-1.5 text-xs text-muted-readable">
            {reloadMessage}
          </p>
        ) : null}
        {/* Advisor Phase 4 (4E, placement K): with an account, the horse sits at the top centre and the
            brief opens in the advisor's panel; a Mac with no account keeps the banner horse and no advisor. */}
        <AdvisorTimelineFrame client={dailyBriefClient?.advisor} fallbackBanner={<>
          <div className="w-full overflow-hidden bg-background">
            <div className="aspect-[1423/367] w-full sm:aspect-[2041/239]">
              <picture className="block h-full w-full">
                <source
                  media="(max-width: 639px)"
                  srcSet="/brand/cadence-timeline-horse-lines-dots-mobile-right-18.png"
                />
                {/* Local files need no Next image loader inside the native webview. */}
                <img
                  src="/brand/cadence-timeline-horse-lines-dots-clear-background.png"
                  width={2041}
                  height={239}
                  alt=""
                  aria-hidden="true"
                  fetchPriority="high"
                  className="block h-full w-full object-fill lg:mt-1"
                />
              </picture>
            </div>
          </div>
        </>} banner={(
          <div className="w-full overflow-hidden bg-background pt-1">
            <img src="/brand/cadence-page-banner-lines-dots.png" width={1965} height={64} alt="" aria-hidden="true" className="block h-auto w-full" />
          </div>
        )}>
        <div className="relative mx-auto w-full max-w-6xl px-3 sm:px-6 lg:px-10">
          <DailyBriefLauncher travelAccountId={dailyBriefSessionKey === "local" ? null : dailyBriefSessionKey} client={dailyBriefClient} desktop sessionKey={dailyBriefSessionKey} />
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
          <div className="grid gap-8 pb-32 sm:pb-24">
            {notificationTarget ? (
              <section className="grid gap-3 border-b border-line py-4" aria-label="Opened reminder">
                <p data-notification-result tabIndex={-1} role={notificationTarget.status === "error" ? "alert" : "status"}
                  className="text-base text-muted-readable">
                  {notificationTarget.status === "loading" ? "Opening reminder…"
                    : notificationTarget.status === "error" ? `Could not open this reminder. ${notificationTarget.message}`
                    : notificationTarget.status === "unavailable" ? "That reminder’s occurrence is no longer available in this local profile."
                    : <>Opened reminder for {notificationTarget.occurrence.title} on <time dateTime={notificationTarget.occurrence.localDate}>{notificationTarget.occurrence.localDate}</time>.</>}
                </p>
                {targetOccurrence && !targetInFeed ? <OccurrenceRow occurrence={targetOccurrence} shortcuts={shortcutsByBehavior[targetOccurrence.behaviorId]} {...actions} /> : null}
              </section>
            ) : null}
            <NeedsDecisionDialog
              title={timeline.needsDecision.title}
              occurrenceCount={timeline.needsDecision.occurrenceCount}
              hasRetainedRows={
                timeline.needsDecision.occurrenceCount === 0 &&
                timeline.needsDecision.daySections.length > 0
              }
            >
              {timeline.needsDecision.daySections.length === 0 ? (
                <p className="border-t border-line pt-4 text-base leading-7 text-muted-readable">
                  {timeline.needsDecision.emptyMessage}
                </p>
              ) : (
                <div className="grid gap-5">
                  {timeline.needsDecision.daySections.map((section) => (
                    <TimelineGroup
                      key={section.key}
                      section={section}
                      {...actions}
                      shortcutsByBehavior={shortcutsByBehavior}
                      variant="needsDecisionDialog"
                      dayNote={timeline.dayNotes?.[section.localDate] ?? ""}
                    />
                  ))}
                </div>
              )}
            </NeedsDecisionDialog>
            <DayProgressTimeline timeline={timeline} context={dayProgress} {...actions}
              shortcutsByBehavior={shortcutsByBehavior} onDayChange={onRefresh} onOpenExternal={openCalendarSourceUrl} />
            {nextFutureDays ? (
              <div className="border-t border-line pt-5">
                <button
                  type="button"
                  onClick={() => onShowMore(nextFutureDays)}
                  className="product-action product-action-primary min-h-11 gap-2 py-2 text-sm font-bold"
                >
                  <Plus aria-hidden="true" size={18} strokeWidth={2.5} />
                  <span>Show more days</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        </AdvisorTimelineFrame>
      </div>
    </MarkDetails>
    </RefreshProvider>
    </LinkProvider>
    </ScreenNavigation.Provider>
  );
}

function MarkDetails({ actions, timezone, children }: Readonly<{ actions?: OccurrenceMarkDetailActions; timezone: string; children: ReactNode }>) {
  return actions ? <OccurrenceMarkDetailsProvider actions={actions} timezone={timezone}>{children}</OccurrenceMarkDetailsProvider> : <>{children}</>;
}
