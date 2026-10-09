import { RuntimeLink, RefreshProvider } from "@cadence/ui/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { NoteShortcut } from "@cadence/core/types/note-shortcut";

import { NeedsDecisionDialog } from "@/components/timeline/NeedsDecisionDialog";
import { openCalendarSourceUrl } from "./calendar/google-calendar";
import { DayProgressTimeline, type DayProgressContext } from "@/components/timeline/DayProgressTimeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { useTimelineWheelReload } from "@/lib/ui/timeline-wheel-reload";
import { timelineBriefKey, type DailyBriefClient } from "@/lib/ui/daily-brief";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import type { NotificationTarget } from "./notification-activation";
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
}>;

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
    <RefreshProvider onRefresh={onRefresh}>
      <div ref={rootRef} className="flex w-full flex-col">
        <h1 className="sr-only">Timeline</h1>
        {reloadMessage ? (
          <p role="status" aria-live="polite"
            className="pointer-events-none fixed left-1/2 top-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] z-30 -translate-x-1/2 border border-line bg-background px-3 py-1.5 text-xs text-muted-readable">
            {reloadMessage}
          </p>
        ) : null}
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
          <div className="relative mx-auto w-full max-w-6xl px-3 sm:px-6 lg:px-10">
            <DailyBriefLauncher sourceKey={timelineBriefKey(timeline)} client={dailyBriefClient} desktop sessionKey={dailyBriefSessionKey} />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
          <div className="grid gap-8 pb-32 sm:pb-24">
            {timeline.archiveNotifications?.length ? (
              <div role="status" className="grid gap-2 border-b border-line py-4 text-sm">
                {timeline.archiveNotifications.map((notice) => (
                  <p key={notice.behaviorId}>“{notice.title}” was automatically archived{notice.endDate ? ` for its ${notice.endDate} end date` : ""}. History is preserved.</p>
                ))}
                <RuntimeLink href="/behaviors" className="product-action product-action-primary justify-self-start">Review archived behaviors</RuntimeLink>
              </div>
            ) : null}
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
      </div>
    </RefreshProvider>
  );
}
