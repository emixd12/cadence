import { NextResponse, type NextRequest } from "next/server";

import {
  ExportAuthError,
  ExportRateLimitError,
  getExportDownload,
  exportFailureLabel,
  type ExportDownloadFormat,
} from "@/lib/services/export.service";
import {
  reportMonitoringError,
  reportMonitoringEvent,
} from "@/lib/monitoring/privacy-safe-events";
import { LaunchCircuitBreakerOpenError } from "@/lib/security/launch-circuit-breakers";

export async function exportDownloadResponse(
  request: NextRequest,
  format: ExportDownloadFormat,
) {
  try {
    const download = await getExportDownload(format, {
      range: request.nextUrl.searchParams.get("range"),
      includeArchived:
        request.nextUrl.searchParams.get("include_archived") === "1",
      includeNotes: request.nextUrl.searchParams.get("include_notes") === "1",
      includeTimeTracking:
        request.nextUrl.searchParams.get("include_time_tracking") === "1",
    });

    return new Response(download.content, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${download.fileName}"`,
        "content-type": download.contentType,
      },
    });
  } catch (error) {
    if (error instanceof ExportAuthError) {
      return jsonError(error.message, 401);
    }

    if (error instanceof ExportRateLimitError) {
      reportMonitoringEvent({
        name: "export_download_rate_limited",
        severity: "warning",
        context: {
          route: request.nextUrl.pathname,
          method: request.method,
          limit: error.limit,
        },
      });
      return jsonError(error.message, 429, error.retryAfterSeconds);
    }

    if (error instanceof LaunchCircuitBreakerOpenError) {
      return jsonError(
        "Export downloads are temporarily unavailable.",
        503,
        error.state.retryAfterSeconds,
      );
    }

    // Log the error class and, for export validation failures, the code-defined label.
    // Never log the raw message: database and provider errors may carry user data.
    reportMonitoringError("export_download_failed", error, {
      route: request.nextUrl.pathname,
      method: request.method,
      format,
      failure: exportFailureLabel(error),
    });
    return jsonError("Unable to prepare export.", 500);
  }
}

function jsonError(
  message: string,
  status: number,
  retryAfterSeconds?: number,
) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(retryAfterSeconds
          ? { "Retry-After": String(retryAfterSeconds) }
          : {}),
      },
    },
  );
}
