"use client";

import { useMemo, type ReactNode } from "react";

import { defaultWebDailyBriefClient } from "@/lib/ui/daily-brief";
import type { AdvisorClient } from "@/lib/ui/advisor";
import { AdvisorProvider, useAdvisor } from "./AdvisorProvider";
import { AdvisorPanel, AdvisorWindow, AdvisorWindowSpacer } from "./AdvisorParts";

/**
 * Advisor plan Phase 4 (4E), placement K, for the Timeline on the web and the Mac:
 * the window horse at the top, the banner (without its horse), the page and the panel.
 * Without a client (a Mac not linked to an account) the page shows `fallbackBanner` and
 * nothing of the advisor.
 */
export function AdvisorTimelineFrame({
  client,
  banner,
  fallbackBanner,
  chatHref = null,
  children,
}: Readonly<{
  client: AdvisorClient | null | undefined;
  /** The banner's wave line with no horse; the horse lives at the top centre now. */
  banner: ReactNode;
  /** The old banner with its horse, for a page with no advisor. */
  fallbackBanner?: ReactNode;
  chatHref?: string | null;
  children: ReactNode;
}>) {
  return (
    <AdvisorProvider client={client} chatHref={chatHref}>
      <AdvisorColumn banner={client ? banner : fallbackBanner ?? banner}>{children}</AdvisorColumn>
      <AdvisorPanel />
    </AdvisorProvider>
  );
}

function AdvisorColumn({ banner, children }: Readonly<{ banner: ReactNode; children: ReactNode }>) {
  const advisor = useAdvisor();
  return (
    <div className={["flex w-full flex-col", advisor?.panelOpen ? "xl:pr-[26rem]" : ""].join(" ")} data-advisor-column>
      <AdvisorWindow />
      {banner}
      <AdvisorWindowSpacer />
      {children}
    </div>
  );
}

/** The web Timeline's frame: the signed-in person's advisor through the web brief client. */
export function WebAdvisorTimelineFrame({ banner, chatHref = null, children }: Readonly<{ banner: ReactNode; chatHref?: string | null; children: ReactNode }>) {
  const client = useMemo(() => defaultWebDailyBriefClient().advisor ?? null, []);
  return <AdvisorTimelineFrame client={client} banner={banner} chatHref={chatHref}>{children}</AdvisorTimelineFrame>;
}
