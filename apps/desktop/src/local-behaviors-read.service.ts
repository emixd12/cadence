import { Temporal } from "@js-temporal/polyfill";
import { resolveAnalyticsDateRange } from "@cadence/core/resolvers/analytics.resolver";
import { assembleAnalyticsView, type AnalyticsSelection } from "@cadence/core/services/analytics";
import { assembleBehaviorPageData } from "@cadence/core/services/behavior-views";
import type { Profile } from "../../../lib/types/database";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand } from "./local-store";
import { withNativeReminderSummary } from "./local-behavior.service";

export async function getLocalBehaviorsPageData(profile: Profile,
  options: AnalyticsSelection & { now?: Temporal.Instant } = {}) {
  const now = options.now ?? Temporal.Now.instant();
  await ensureLocalOccurrencesFresh(profile, now);
  const profileId = profile.id;
  const range = resolveAnalyticsDateRange({ now, timezone: profile.timezone, rangeDays: options.rangeDays });
  const priorDate = Temporal.PlainDate.from(range.startLocalDate).subtract({ days: 1 }).toString();
  const [graphs, categories, rows, priorUnresolved] = await Promise.all([
    localCommand("readBehaviorGraphs", { profileId }),
    localCommand("readCategories", { profileId }),
    localCommand("readOccurrences", { profileId, startLocalDate: range.startLocalDate, endLocalDate: range.endLocalDate }),
    localCommand("readOccurrences", { profileId, startLocalDate: "0001-01-01", endLocalDate: priorDate, status: "unresolved" }),
  ]);
  const behaviors = graphs.map((graph) => toLocalBehaviorGraphRecord(graph, categories));
  const occurrences = rows.filter((row) => row.local_date >= range.startLocalDate);
  const needsDecisionOccurrences = [...priorUnresolved,
    ...rows.filter((row) => row.status === "unresolved" && row.local_date < range.endLocalDate)];
  const history = await localCommand("readOccurrenceHistory", { profileId, occurrenceIds: occurrences.map(({ id }) => id) });
  // Ended and Paused: views carry runState so the shared list groups Not running items.
  const page = assembleBehaviorPageData({ behaviors, categories, profileTimezone: profile.timezone, now });
  return {
    behaviors: { ...page, activeBehaviors: page.activeBehaviors.map(withNativeReminderSummary),
      archivedBehaviors: page.archivedBehaviors.map(withNativeReminderSummary) },
    analytics: assembleAnalyticsView({ ...options, now, timezone: profile.timezone, rangeDays: range.rangeDays,
      behaviors, occurrences, needsDecisionOccurrences,
      timeSessions: history.timeSessions.filter((session) => Temporal.Instant.compare(session.started_at, now) <= 0),
    }),
  };
}
