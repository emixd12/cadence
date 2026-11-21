import { createContext, useContext, type ComponentProps } from "react";
import {
  LinkProvider,
  RefreshProvider,
  type RuntimeLinkProps,
} from "@cadence/ui/runtime";

import { BehaviorCreateSection } from "@/components/behaviors/BehaviorCreateSection";
import { BehaviorList } from "@/components/behaviors/BehaviorList";
import type { BehaviorFormAction } from "@/lib/types/behavior";
import type { SourceLinkCoordinator } from "@/lib/ui/source-links";
import { DesktopScreenFrame } from "./desktop-screen-frame";

export type BehaviorReviewSelection = Readonly<{
  rangeDays?: number;
  selectedBehaviorId?: string;
  selectedDayLocalDate?: string;
}>;
type NavigateReview = (selection: BehaviorReviewSelection) => void;
const ReviewNavigation = createContext<NavigateReview | null>(null);

export type BehaviorsScreenProps = ComponentProps<typeof BehaviorList> &
  Readonly<{
    createAction: BehaviorFormAction;
    defaultTimezone: string;
    onRefresh: () => void;
    onNavigateReview: NavigateReview;
    /** Ticket 330: Complete from Hevy while this Mac is linked; null in local mode. */
    sourceLinkCoordinator?: SourceLinkCoordinator | null;
  }>;

export function BehaviorsScreen({
  createAction,
  defaultTimezone,
  onRefresh,
  onNavigateReview,
  sourceLinkCoordinator = null,
  ...listProps
}: BehaviorsScreenProps) {
  const hasBehaviors =
    listProps.activeBehaviors.length > 0 ||
    listProps.archivedBehaviors.length > 0;
  return (
    <ReviewNavigation.Provider value={onNavigateReview}>
      <LinkProvider component={DesktopReviewLink}>
        <RefreshProvider onRefresh={onRefresh}>
          <DesktopScreenFrame title="Behaviors">
            <BehaviorCreateSection
              action={createAction}
              categories={listProps.categories}
              defaultTimezone={defaultTimezone}
              defaultOpen={!hasBehaviors}
              reminderRuntime="desktop"
              sourceLinkCoordinator={sourceLinkCoordinator}
            />
            <BehaviorList {...listProps} reminderRuntime="desktop" sourceLinkCoordinator={sourceLinkCoordinator} />
          </DesktopScreenFrame>
        </RefreshProvider>
      </LinkProvider>
    </ReviewNavigation.Provider>
  );
}

function DesktopReviewLink({
  href,
  scroll: _scroll,
  onClick,
  ...props
}: RuntimeLinkProps) {
  void _scroll;
  const navigate = useContext(ReviewNavigation);
  if (!navigate)
    throw new Error("Desktop review navigation is not configured.");
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(parseBehaviorReviewHref(href));
      }}
    />
  );
}

export function parseBehaviorReviewHref(href: string): BehaviorReviewSelection {
  const url = new URL(href, "https://cadence.local");
  if (url.origin !== "https://cadence.local" || url.pathname !== "/behaviors") {
    throw new Error("Unsupported desktop behavior review destination.");
  }
  const range = url.searchParams.get("range");
  const rangeDays = range === null ? undefined : Number(range);
  return {
    rangeDays:
      rangeDays !== undefined && Number.isFinite(rangeDays)
        ? rangeDays
        : undefined,
    selectedBehaviorId: url.searchParams.get("behavior") || undefined,
    selectedDayLocalDate: url.searchParams.get("day") || undefined,
  };
}
