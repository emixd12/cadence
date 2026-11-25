import {
  purgeEndedDailyBriefDays,
  purgeExpiredAgentRunContents,
  purgeExpiredGoogleCalendarAiData,
} from "@/lib/db/agent-runs.repo";
import { purgeEndedBriefMoveText } from "@/lib/services/brief-moves.service";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/**
 * Advisor plan Phase 1A: the scheduled deletion job for agent run content.
 * Runs with the daily occurrence sync cron. It deletes content past its expiry
 * (30 days, or the end of its local day for calendar-derived text) and leaves
 * the agent_runs metadata. Agents also delete a person's expired content each
 * time they store new content, so a missed cron run delays nothing visible.
 */
export async function runAgentRunContentMaintenance(
  // Advisor Phase 3: saved brief text and move-line calendar titles also go once their local day has ended.
  purge: (signal: AbortSignal) => Promise<number> = async (signal) => {
    const client = createServiceRoleClient();
    return await purgeExpiredAgentRunContents(client, signal)
      + await purgeEndedDailyBriefDays(client, signal)
      + await purgeEndedBriefMoveText(client, signal)
      + await purgeExpiredGoogleCalendarAiData(client, signal);
  },
): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 8000);
  try {
    const deleted = await purge(controller.signal);
    controller.signal.throwIfAborted();
    reportMonitoringEvent({ name: "agent_run_content_maintenance_completed", context: { content_deleted: deleted } });
  } catch {
    try {
      reportMonitoringEvent({
        name: controller.signal.aborted ? "agent_run_content_maintenance_timed_out" : "agent_run_content_maintenance_failed",
        severity: "error",
        context: { outcome: "unknown" },
      });
    } catch {
      // A failed monitoring sink must not fail the cron.
    }
  } finally {
    clearTimeout(deadline);
  }
}
