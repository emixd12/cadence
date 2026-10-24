"use client";

import { FirstRunOnboardingPanel } from "@/components/onboarding/FirstRunOnboardingPanel";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";

const onboardingFixture: FirstRunOnboardingState = {
  hasAnyBehavior: false,
  hasImportRuns: false,
  timezone: "America/New_York",
  vapidPublicKey: "",
  travel: { hasHome: false, hasMode: false },
};

// Synthetic routing report: the bench never calls the travel routes endpoint.
const routingConfigured = async () => true;

export function FirstRunOnboardingBench() {
  return (
    <FirstRunOnboardingPanel
      onboarding={onboardingFixture}
      storageKey="cadence-first-run-bench-dismissed"
      readTravelRoutingConfigured={routingConfigured}
    />
  );
}
