import type { DailyBriefConnectedSource } from "@cadence/core/types/daily-brief";
import { dailyBriefSourceFlags } from "@cadence/core/services/daily-brief-sources";
import type { DailyBriefPreferences } from "@/lib/db/daily-brief.repo";

/**
 * Ticket 306 preference fixture. `allow` turns the one connected-sources choice on
 * and excludes every source it does not name; without it the choice is off. Google
 * Calendar reads the Timeline connection (Ticket 307) unless `googleCalendarSource` is null.
 */
export function dailyBriefPreferences(
  options: Partial<Omit<DailyBriefPreferences, "excludedSources">> & { allow?: readonly DailyBriefConnectedSource[] } = {},
): DailyBriefPreferences {
  const { allow, ...rest } = options;
  return {
    enabled: true, includeReminderHistory: false, includeNotes: false, revision: 3, googleCalendarSource: "timeline",
    useConnectedSources: allow !== undefined,
    excludedSources: dailyBriefSourceFlags((source) => allow !== undefined && !allow.includes(source)),
    ...rest,
  };
}
