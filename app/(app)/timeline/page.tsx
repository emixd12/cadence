import type { Metadata } from "next";
import { getImageProps } from "next/image";
import { Suspense } from "react";

import { ScreenContentLoading } from "@/components/layout/ScreenFrame";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { AiFeaturesApproval } from "@/components/onboarding/AiFeaturesApproval";
import { FirstRunOnboardingPanel } from "@/components/onboarding/FirstRunOnboardingPanel";
import { Timeline } from "@/components/timeline/Timeline";
import { getCurrentUserClaims } from "@/lib/auth/current-user";
import { LEAVE_REMINDER_LINK_PARAM, parseLeaveReminderDigest } from "@/lib/ui/leave-reminder-link";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import { getTimelinePageBundle } from "@/lib/services/timeline.service";
import { listAcceptedNoteShortcutsForCurrentUser } from "@/lib/services/note-shortcut.service";
import {
  markOccurrenceStatusAction,
  resetTimeTrackingAction,
  saveDayNoteAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  updateOccurrenceNoteAction,
} from "./actions";
import {
  keepMovedOccurrenceAction,
  moveOccurrenceAction,
  recordMoveReasonAction,
  revertOccurrenceMoveAction,
  suggestMoveTimesAction,
} from "./move-actions";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { OccurrenceMarkDetailsProvider, type OccurrenceMarkDetailActions } from "@/components/timeline/OccurrenceMarkDetails";
import { recordDoneAtAction, recordNotDoneReasonAction } from "./mark-detail-actions";
import { MoveConflictNotices, type MoveConflictNotice } from "@/components/timeline/MoveConflictNotices";
import { hasPersonMovedBefore, listOpenMoveConflicts } from "@/lib/services/occurrence-move.service";
import { systemClock } from "@/lib/services/clock";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Timeline",
};

export const dynamic = "force-dynamic";

// Advisor plan, Phase 2C: the person's own per-day moves from the Timeline row.
const MARK_DETAIL_ACTIONS: OccurrenceMarkDetailActions = {
  doneAt: recordDoneAtAction,
  notDoneReason: recordNotDoneReasonAction,
};

const MOVE_ACTIONS: OccurrenceMoveActions = {
  move: moveOccurrenceAction,
  revert: revertOccurrenceMoveAction,
  reason: recordMoveReasonAction,
  suggest: suggestMoveTimesAction,
  keep: keepMovedOccurrenceAction,
};

const TIMELINE_BANNER_IMAGES = {
  desktop: {
    src: "/brand/cadence-timeline-horse-lines-dots-clear-background.png",
    width: 2041,
    height: 239,
  },
  mobile: {
    src: "/brand/cadence-timeline-horse-lines-dots-mobile-right-18.png",
    width: 1423,
    height: 367,
  },
} as const;

type TimelinePageProps = Readonly<{
  searchParams?: Promise<{
    days?: string | string[];
    [LEAVE_REMINDER_LINK_PARAM]?: string | string[];
  }>;
}>;

export default async function TimelinePage({ searchParams }: TimelinePageProps) {
  const params = await searchParams;
  const futureDays = parseFutureDays(params?.days);
  // Ticket 278: a leave reminder's link names its trip by digest only.
  const leaveReminderDigest = parseLeaveReminderDigest(params?.[LEAVE_REMINDER_LINK_PARAM]);

  return (
    <div className="flex w-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
        <h1 className="sr-only">Timeline</h1>
      </div>

      <TimelineBanner />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
        <Suspense fallback={<ScreenContentLoading label="Loading timeline" />}>
          <TimelineContent futureDays={futureDays} leaveReminderDigest={leaveReminderDigest} />
        </Suspense>
      </div>
    </div>
  );
}

async function TimelineContent({
  futureDays,
  leaveReminderDigest,
}: Readonly<{
  futureDays?: number;
  leaveReminderDigest: string | null;
}>) {
  const { timeline, onboarding } = await withPerformanceRoute(
    "/timeline",
    "page.bundle_load",
    () =>
      getTimelinePageBundle({
        futureDays,
      }),
    {
      counts: (bundle) => ({
        timeline_sections: bundle.timeline.daySections.length,
        has_behavior: Number(bundle.onboarding.hasAnyBehavior),
        has_import_runs: Number(bundle.onboarding.hasImportRuns),
      }),
    },
  );
  const shortcutsByBehavior = await listAcceptedNoteShortcutsForCurrentUser();
  const { userId } = await getCurrentUserClaims();
  const moveState = await loadMoveState(userId, timeline.todayLocalDate);

  return (
    <OccurrenceMovesProvider
      actions={MOVE_ACTIONS}
      timezone={timeline.timezone}
      todayLocalDate={timeline.todayLocalDate}
      hasMovedBefore={moveState.hasMovedBefore}
    >
      <OccurrenceMarkDetailsProvider actions={MARK_DETAIL_ACTIONS} timezone={timeline.timezone}>
      <DailyBriefLauncher travelAccountId={userId} />
      {/* Advisor 4F: the one AI features question comes before the setup pop-up, in its place. */}
      <AiFeaturesApproval>
        <FirstRunOnboardingPanel onboarding={onboarding} />
      </AiFeaturesApproval>
      <MoveConflictNotices conflicts={moveState.conflicts} timeline={timeline} />
      <Timeline
        key={userId}
        travelAccountId={userId}
        timeline={timeline}
        statusAction={markOccurrenceStatusAction}
        noteAction={updateOccurrenceNoteAction}
        startTimeTrackingAction={startTimeTrackingAction}
        stopTimeTrackingAction={stopTimeTrackingAction}
        resetTimeTrackingAction={resetTimeTrackingAction}
        shortcutsByBehavior={shortcutsByBehavior}
        dayNoteAction={saveDayNoteAction}
        liveCalendar
        leaveReminderDigest={leaveReminderDigest}
      />
      </OccurrenceMarkDetailsProvider>
    </OccurrenceMovesProvider>
  );
}

/**
 * Whether the one-time first-move line is still owed, and today's open schedule-edit
 * collision notices. A read failure hides both and leaves the Timeline working.
 */
async function loadMoveState(userId: string | null, todayLocalDate: string)
  : Promise<Readonly<{ hasMovedBefore: boolean; conflicts: readonly MoveConflictNotice[] }>> {
  if (!userId) return { hasMovedBefore: true, conflicts: [] };
  try {
    const caller = { supabase: await createClient(), userId, now: systemClock.now() };
    const [hasMovedBefore, conflicts] = await Promise.all([
      hasPersonMovedBefore(caller),
      listOpenMoveConflicts(caller, todayLocalDate),
    ]);
    return { hasMovedBefore, conflicts };
  } catch {
    return { hasMovedBefore: true, conflicts: [] };
  }
}

function TimelineBanner() {
  const sharedImageProps = {
    alt: "",
    "aria-hidden": true,
    className: "block h-full w-full object-fill lg:mt-1",
    fetchPriority: "high",
    loading: "eager",
    sizes: "100vw",
  } as const;

  const {
    props: { sizes: mobileSizes, srcSet: mobileSrcSet },
  } = getImageProps({
    ...sharedImageProps,
    ...TIMELINE_BANNER_IMAGES.mobile,
  });

  const {
    props: { sizes: desktopSizes, srcSet: desktopSrcSet, ...desktopImageProps },
  } = getImageProps({
    ...sharedImageProps,
    ...TIMELINE_BANNER_IMAGES.desktop,
  });

  return (
    <div className="w-full overflow-hidden bg-background">
      <div className="aspect-[1423/367] w-full sm:aspect-[2041/239]">
        <picture className="block h-full w-full">
          <source
            media="(max-width: 639px)"
            sizes={mobileSizes}
            srcSet={mobileSrcSet}
          />
          <source
            media="(min-width: 640px)"
            sizes={desktopSizes}
            srcSet={desktopSrcSet}
          />
          <img {...desktopImageProps} alt="" aria-hidden="true" />
        </picture>
      </div>
    </div>
  );
}

function parseFutureDays(value: string | string[] | undefined): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (!rawValue) {
    return undefined;
  }

  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}
