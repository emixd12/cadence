import { purgeExpiredOAuthRecords } from "@/lib/db/oauth.repo";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/** Runs independently of MCP enablement and occurrence batch availability. */
export async function runOAuthMaintenance(): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 8000);
  try {
    const counts = await purgeExpiredOAuthRecords(createServiceRoleClient(), controller.signal);
    controller.signal.throwIfAborted();
    reportMonitoringEvent({
      name: "oauth_maintenance_completed",
      context: {
        // These fixed count labels avoid the monitor's credential-key filter.
        codes_deleted: counts.authorization_codes,
        access_deleted: counts.access_tokens,
        families_deleted: counts.token_families,
        clients_deleted: counts.clients,
        retries_deleted: counts.idempotency_records,
        activity_deleted: counts.activity,
        counters_deleted: counts.rate_limit_counters,
      },
    });
  } catch {
    // Abort settles the HTTP request, not necessarily the database transaction.
    reportMonitoringEvent({
      name: controller.signal.aborted ? "oauth_maintenance_timed_out" : "oauth_maintenance_failed",
      severity: "error",
      context: { outcome: "unknown" },
    });
  } finally {
    clearTimeout(deadline);
  }
}
