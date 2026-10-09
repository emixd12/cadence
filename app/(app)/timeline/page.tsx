import type { Metadata } from "next";
import { getImageProps } from "next/image";
import { Suspense } from "react";

import { ScreenContentLoading } from "@/components/layout/ScreenFrame";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { timelineBriefKey } from "@/lib/ui/daily-brief";
import { FirstRunOnboardingPanel } from "@/components/onboarding/FirstRunOnboardingPanel";
import { Timeline } from "@/components/timeline/Timeline";
import { getCurrentUserClaims } from "@/lib/auth/current-user";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import { getTimelinePageBundle } from "@/lib/services/timeline.service";
import { listAcceptedNoteShortcutsForCurrentUser } from "@/lib/services/note-shortcut.service";
import {
  markOccurrenceStatusAction,
  resetTimeTrackingAction,
  startTimeTrackingAction,
  stopTimeTrackingAction,
  updateOccurrenceNoteAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Timeline",
};

export const dynamic = "force-dynamic";

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
  }>;
}>;

export default async function TimelinePage({ searchParams }: TimelinePageProps) {
  const params = await searchParams;
  const futureDays = parseFutureDays(params?.days);

  return (
    <div className="flex w-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
        <h1 className="sr-only">Timeline</h1>
      </div>

      <TimelineBanner />

      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
        <Suspense fallback={<ScreenContentLoading label="Loading timeline" />}>
          <TimelineContent futureDays={futureDays} />
        </Suspense>
      </div>
    </div>
  );
}

async function TimelineContent({
  futureDays,
}: Readonly<{
  futureDays?: number;
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

  return (
    <>
      <DailyBriefLauncher sourceKey={timelineBriefKey(timeline)} />
      <FirstRunOnboardingPanel onboarding={onboarding} />
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
        liveCalendar
      />
    </>
  );
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
