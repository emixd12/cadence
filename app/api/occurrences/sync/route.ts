import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  buildAuthFailureRateLimitKey,
  occurrenceSyncAuthFailureLimiter,
} from "@/lib/security/auth-failure-rate-limits";
import {
  reportMonitoringError,
  reportMonitoringEvent,
} from "@/lib/monitoring/privacy-safe-events";
import type { RateLimitResult } from "@/lib/security/rate-limiter";
import {
  assertLaunchCircuitBreakerClosed,
  LaunchCircuitBreakerOpenError,
} from "@/lib/security/launch-circuit-breakers";
import { processOccurrenceSyncHorizons } from "@/lib/services/occurrence.service";
import { runOAuthMaintenance } from "@/lib/services/oauth-maintenance.service";

export const runtime = "nodejs";

const RATE_LIMIT_SCOPE = "occurrence-sync-auth";
const MAX_OCCURRENCE_SYNC_LIMIT = 100;

export async function GET(request: NextRequest) {
  return processOccurrenceSyncRequest(request);
}

export async function POST(request: NextRequest) {
  return processOccurrenceSyncRequest(request);
}

async function processOccurrenceSyncRequest(request: NextRequest) {
  const configuredSecrets = readConfiguredSecrets();

  if (configuredSecrets.length === 0) {
    reportMonitoringEvent({
      name: "occurrence_sync_not_configured",
      severity: "error",
      context: routeContext(request),
    });
    return jsonError("Occurrence sync is not configured.", 503);
  }

  const rateLimitKey = buildAuthFailureRateLimitKey(
    RATE_LIMIT_SCOPE,
    request.headers,
  );
  const rateLimit = occurrenceSyncAuthFailureLimiter.check(rateLimitKey);

  if (!rateLimit.allowed) {
    reportMonitoringEvent({
      name: "occurrence_sync_auth_rate_limited",
      severity: "warning",
      context: routeContext(request),
    });
    return rateLimitError(rateLimit);
  }

  const requestSecret = readRequestSecret(request);

  if (!configuredSecrets.some((secret) => secretMatches(requestSecret, secret))) {
    const failureLimit =
      occurrenceSyncAuthFailureLimiter.recordFailure(rateLimitKey);

    if (!failureLimit.allowed) {
      reportMonitoringEvent({
        name: "occurrence_sync_auth_rate_limited",
        severity: "warning",
        context: routeContext(request),
      });
      return rateLimitError(failureLimit);
    }

    reportMonitoringEvent({
      name: "occurrence_sync_unauthorized",
      severity: "warning",
      context: routeContext(request),
    });
    return jsonError("Unauthorized occurrence sync request.", 401);
  }

  occurrenceSyncAuthFailureLimiter.reset(rateLimitKey);

  const maintenance = runOAuthMaintenance().catch(() => {
    try {
      reportMonitoringEvent({ name: "oauth_maintenance_failed", severity: "error", context: { outcome: "unknown" } });
    } catch {
      // A failed monitoring sink must not replace the occurrence result or error.
    }
  });
  try {
    return await processAuthenticatedOccurrenceSyncRequest(request);
  } finally {
    await maintenance;
  }
}

async function processAuthenticatedOccurrenceSyncRequest(request: NextRequest) {
  try {
    assertLaunchCircuitBreakerClosed("occurrence_sync_batches");
  } catch (error) {
    if (error instanceof LaunchCircuitBreakerOpenError) {
      return jsonError(
        "Occurrence sync is temporarily unavailable.",
        503,
        error.state.retryAfterSeconds,
      );
    }

    throw error;
  }

  try {
    const result = await processOccurrenceSyncHorizons({
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
    });

    reportMonitoringEvent({
      name: "occurrence_sync_completed",
      context: {
        ...routeContext(request),
        checked: result.checked,
        synced: result.synced,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    reportMonitoringError("occurrence_sync_failed", error, routeContext(request));
    return jsonError("Unable to sync occurrences.", 500);
  }
}

function readConfiguredSecrets(): string[] {
  const secrets = [
    process.env.REMINDER_PROCESS_SECRET,
    process.env.CRON_SECRET,
  ].flatMap((value) => {
    const normalized = value?.trim();
    return normalized ? [normalized] : [];
  });

  return Array.from(new Set(secrets));
}

function readRequestSecret(request: NextRequest): string | null {
  const headerSecret = request.headers.get("x-reminder-process-secret")?.trim();

  if (headerSecret) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization")?.trim();
  const bearerPrefix = "Bearer ";

  if (authorization?.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim();
  }

  return null;
}

function secretMatches(value: string | null, expected: string): boolean {
  if (!value) {
    return false;
  }

  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.min(parsed, MAX_OCCURRENCE_SYNC_LIMIT);
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
      headers: retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
    },
  );
}

function rateLimitError(result: RateLimitResult) {
  return NextResponse.json(
    {
      ok: false,
      error: "Too many failed attempts. Try again later.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

function routeContext(request: NextRequest) {
  return {
    route: "/api/occurrences/sync",
    method: request.method,
  };
}
