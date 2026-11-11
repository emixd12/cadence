import {
  DAILY_BRIEF_CONNECTED_SOURCES,
  type DailyBriefConnectedSource,
  type DailyBriefSourceFlags,
  type DailyBriefSourceStatus,
} from "../types/daily-brief";

/**
 * Ticket 306: Daily Brief has one choice for connected sources plus per-source
 * exclusions. A source connected later is covered by the choice already made.
 */
export type DailyBriefSourceChoice = Readonly<{
  enabled: boolean;
  useConnectedSources: boolean;
  excludedSources: DailyBriefSourceFlags;
}>;

export const NO_DAILY_BRIEF_SOURCES: DailyBriefSourceFlags = Object.freeze({
  googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false,
});

export function dailyBriefSourceFlags(value: (source: DailyBriefConnectedSource) => boolean): DailyBriefSourceFlags {
  return Object.freeze(Object.fromEntries(DAILY_BRIEF_CONNECTED_SOURCES.map((source) => [source, value(source)]))) as DailyBriefSourceFlags;
}

/** True when the choice lets the brief read this source once it has something to read. */
export function dailyBriefSourceAllowed(choice: DailyBriefSourceChoice, source: DailyBriefConnectedSource): boolean {
  return choice.enabled && choice.useConnectedSources && !choice.excludedSources[source];
}

/** The sources a brief reads now: allowed by the choice and ready. */
export function dailyBriefSourcesUsed(
  choice: DailyBriefSourceChoice,
  status: Readonly<Record<DailyBriefConnectedSource, DailyBriefSourceStatus>>,
): DailyBriefSourceFlags {
  return dailyBriefSourceFlags((source) => dailyBriefSourceAllowed(choice, source) && status[source] === "ready");
}

/**
 * Maps per-source allowances (stored before Ticket 306, or sent by an older client)
 * to the one choice. The choice is on when Daily Brief is on and at least one source
 * was allowed; then every source that was not allowed is excluded. With nothing
 * allowed the choice is off and nothing is excluded, as for a new account.
 */
export function dailyBriefChoiceFromAllowed(enabled: boolean, allowed: DailyBriefSourceFlags): Omit<DailyBriefSourceChoice, "enabled"> {
  const useConnectedSources = enabled && DAILY_BRIEF_CONNECTED_SOURCES.some((source) => allowed[source]);
  return {
    useConnectedSources,
    excludedSources: useConnectedSources ? dailyBriefSourceFlags((source) => !allowed[source]) : NO_DAILY_BRIEF_SOURCES,
  };
}
