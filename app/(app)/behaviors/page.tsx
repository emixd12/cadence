import type { Metadata } from "next";
import { Suspense } from "react";

import { BehaviorCreateSection } from "@/components/behaviors/BehaviorCreateSection";
import { BehaviorList } from "@/components/behaviors/BehaviorList";
import {
  ScreenContentLoading,
  ScreenFrame,
} from "@/components/layout/ScreenFrame";
import { getAnalyticsPageData } from "@/lib/services/analytics.service";
import { getBehaviorPageData } from "@/lib/services/behavior.service";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import { getNoteShortcutViewForCurrentUser } from "@/lib/services/note-shortcut.service";
import { manageNoteShortcutAction } from "@/app/(app)/note-shortcuts/actions";
import {
  archiveBehaviorAction,
  behaviorRunAction,
  createBehaviorAction,
  markBehaviorReviewOccurrenceStatusAction,
  resetBehaviorReviewOccurrenceTimeTrackingAction,
  restoreBehaviorAction,
  stopBehaviorReviewOccurrenceTimeTrackingAction,
  updateBehaviorArchiveNoteAction,
  updateBehaviorAction,
  updateBehaviorReviewOccurrenceNoteAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Behaviors",
};

export const dynamic = "force-dynamic";

type BehaviorsPageProps = Readonly<{
  searchParams?: Promise<{
    range?: string | string[];
    behavior?: string | string[];
    day?: string | string[];
  }>;
}>;

export default async function BehaviorsPage({
  searchParams,
}: BehaviorsPageProps) {
  const params = await searchParams;
  const rangeDays = parseNumberParam(params?.range);
  const selectedBehaviorId = parseStringParam(params?.behavior);
  const selectedDayLocalDate = parseStringParam(params?.day);

  return (
    <ScreenFrame title="Behaviors">
      <Suspense fallback={<ScreenContentLoading label="Loading behaviors" />}>
        <BehaviorsContent
          rangeDays={rangeDays}
          selectedBehaviorId={selectedBehaviorId}
          selectedDayLocalDate={selectedDayLocalDate}
        />
      </Suspense>
    </ScreenFrame>
  );
}

async function BehaviorsContent({
  rangeDays,
  selectedBehaviorId,
  selectedDayLocalDate,
}: Readonly<{
  rangeDays?: number;
  selectedBehaviorId?: string;
  selectedDayLocalDate?: string;
}>) {
  const [data, analytics] = await withPerformanceRoute(
    "/behaviors",
    "page.data_load",
    () =>
      Promise.all([
        getBehaviorPageData(),
        getAnalyticsPageData({
          rangeDays,
          selectedBehaviorId,
          selectedDayLocalDate,
        }),
      ]),
    {
      counts: ([pageData, analyticsView]) => ({
        categories: pageData.categories.length,
        active_behaviors: pageData.activeBehaviors.length,
        archived_behaviors: pageData.archivedBehaviors.length,
        range_days: analyticsView.rangeDays,
        behavior_summaries: analyticsView.behaviorSummaries.length,
        selected_day_occurrences:
          analyticsView.selectedBehaviorDay?.occurrences.length ?? 0,
      }),
    },
  );
  const hasBehaviors =
    data.activeBehaviors.length > 0 || data.archivedBehaviors.length > 0;
  const noteShortcutViews = Object.fromEntries(await Promise.all(
    [...data.activeBehaviors, ...data.archivedBehaviors].map(async (behavior) => [
      behavior.id,
      await getNoteShortcutViewForCurrentUser(behavior.id),
    ] as const),
  ));

  return (
    <>
      <BehaviorCreateSection
        action={createBehaviorAction}
        categories={data.categories}
        defaultTimezone={data.defaultTimezone}
        defaultOpen={!hasBehaviors}
      />

      <BehaviorList
        activeBehaviors={data.activeBehaviors}
        archivedBehaviors={data.archivedBehaviors}
        categories={data.categories}
        analytics={analytics}
        updateAction={updateBehaviorAction}
        archiveAction={archiveBehaviorAction}
        restoreAction={restoreBehaviorAction}
        archiveNoteAction={updateBehaviorArchiveNoteAction}
        runAction={behaviorRunAction}
        statusAction={markBehaviorReviewOccurrenceStatusAction}
        noteAction={updateBehaviorReviewOccurrenceNoteAction}
        stopTimeTrackingAction={stopBehaviorReviewOccurrenceTimeTrackingAction}
        resetTimeTrackingAction={resetBehaviorReviewOccurrenceTimeTrackingAction}
        noteShortcutViews={noteShortcutViews}
        noteShortcutAction={manageNoteShortcutAction}
      />
    </>
  );
}

function parseNumberParam(value: string | string[] | undefined): number | undefined {
  const rawValue = parseStringParam(value);

  if (!rawValue) {
    return undefined;
  }

  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function parseStringParam(value: string | string[] | undefined): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;

  return rawValue || undefined;
}
