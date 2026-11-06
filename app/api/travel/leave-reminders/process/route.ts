import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { reportMonitoringError, reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  buildAuthFailureRateLimitKey,
  leaveReminderProcessAuthFailureLimiter,
} from "@/lib/security/auth-failure-rate-limits";
import {
  assertLaunchCircuitBreakerClosed,
  LaunchCircuitBreakerOpenError,
} from "@/lib/security/launch-circuit-breakers";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createLeaveReminderDelivery } from "@/lib/services/leave-reminder-delivery";
import {
  createHostedLeaveReminderAccountPort,
  hostedDueAccountSelection,
  processLeaveReminders,
} from "@/lib/services/leave-reminder-job.service";
import { assertTravelProviderReady, readTravelProviderConfig } from "@/lib/services/travel-provider";

// Ticket 277 (decision D3): the hosted leave reminder job. Vercel Cron calls it every
// 5 minutes with `Authorization: Bearer $CRON_SECRET`. It stays off until
// CADENCE_LEAVE_REMINDER_JOB is exactly "enabled", and every missing piece fails closed.

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/travel/leave-reminders/process";
const RATE_LIMIT_SCOPE = "leave-reminder-process-auth";

type OidcSubjectSource = "header" | "file" | "env" | "none";
let oidcPresenceReported = false;

export async function GET(request: NextRequest) {
  return processLeaveReminderRequest(request);
}

export async function POST(request: NextRequest) {
  return processLeaveReminderRequest(request);
}

async function processLeaveReminderRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    reportMonitoringEvent({ name: "leave_reminder_process_not_configured", severity: "error", context: routeContext(request) });
    return jsonError("Leave reminder processing is not configured.", 503);
  }

  const rateLimitKey = buildAuthFailureRateLimitKey(RATE_LIMIT_SCOPE, request.headers);
  const rateLimit = leaveReminderProcessAuthFailureLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) {
    reportMonitoringEvent({ name: "leave_reminder_process_auth_rate_limited", severity: "warning", context: routeContext(request) });
    return jsonError("Too many failed attempts. Try again later.", 429, rateLimit.retryAfterSeconds);
  }
  if (!secretMatches(readBearer(request), cronSecret)) {
    const failure = leaveReminderProcessAuthFailureLimiter.recordFailure(rateLimitKey);
    reportMonitoringEvent({ name: failure.allowed ? "leave_reminder_process_unauthorized" : "leave_reminder_process_auth_rate_limited", severity: "warning", context: routeContext(request) });
    return failure.allowed
      ? jsonError("Unauthorized leave reminder processing request.", 401)
      : jsonError("Too many failed attempts. Try again later.", 429, failure.retryAfterSeconds);
  }
  leaveReminderProcessAuthFailureLimiter.reset(rateLimitKey);

  if (process.env.CADENCE_LEAVE_REMINDER_JOB?.trim() !== "enabled") {
    return NextResponse.json({ ok: true, enabled: false, result: null });
  }

  try {
    assertLaunchCircuitBreakerClosed("leave_reminder_batches");
  } catch (error) {
    if (error instanceof LaunchCircuitBreakerOpenError) {
      return jsonError("Leave reminder processing is temporarily unavailable.", 503, error.state.retryAfterSeconds);
    }
    throw error;
  }

  // Hosted routing needs the Vercel OIDC token as its Google subject token. The lookup
  // order is Vercel's: the request header, then the token file, then the variable.
  const subject = readOidcSubjectToken(request);
  reportOidcPresenceOnce(subject.source, request);
  const config = readTravelProviderConfig(process.env, subject.value);
  try {
    assertTravelProviderReady(config);
  } catch {
    reportMonitoringEvent({ name: "leave_reminder_process_travel_unavailable", severity: "warning", context: routeContext(request) });
    return jsonError("Travel estimates are not available for leave reminders.", 503);
  }

  const deliver = createLeaveReminderDelivery();
  if (!deliver) {
    reportMonitoringEvent({ name: "leave_reminder_process_delivery_unavailable", severity: "warning", context: routeContext(request) });
    return jsonError("Leave reminder delivery is not available.", 503);
  }

  try {
    const result = await processLeaveReminders({
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
      deliver,
      selectDueAccounts: hostedDueAccountSelection(createServiceRoleClient()),
      openAccount: (userId, now) => createHostedLeaveReminderAccountPort(userId, now, config),
    });
    reportMonitoringEvent({ name: "leave_reminder_process_completed", context: { ...routeContext(request), ...result } });
    return NextResponse.json({ ok: true, enabled: true, result });
  } catch (error) {
    reportMonitoringError("leave_reminder_process_failed", error, routeContext(request));
    return jsonError("Unable to process leave reminders.", 500);
  }
}

function readOidcSubjectToken(request: NextRequest): Readonly<{ value: string | null; source: OidcSubjectSource }> {
  const header = request.headers.get("x-vercel-oidc-token")?.trim();
  if (header) return { value: header, source: "header" };
  const file = process.env.VERCEL_OIDC_TOKEN_FILE?.trim();
  if (file) {
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) return { value, source: "file" };
    } catch {
      // An unreadable file falls through to the variable, then fails closed.
    }
  }
  const variable = process.env.VERCEL_OIDC_TOKEN?.trim();
  return variable ? { value: variable, source: "env" } : { value: null, source: "none" };
}

/** Open for Ticket 277 (Ticket 276 verifier): log only whether the token was present, once. */
function reportOidcPresenceOnce(source: OidcSubjectSource, request: NextRequest): void {
  if (oidcPresenceReported || process.env.VERCEL_ENV !== "production") return;
  oidcPresenceReported = true;
  reportMonitoringEvent({
    name: "leave_reminder_process_oidc_subject",
    context: { ...routeContext(request), oidc_subject_present: source !== "none", oidc_subject_source: source },
  });
}

function readBearer(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;
}

function secretMatches(value: string | null, expected: string): boolean {
  if (!value) return false;
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function jsonError(message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json({ ok: false, error: message }, {
    status,
    headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
  });
}

function routeContext(request: NextRequest) {
  return { route: ROUTE, method: request.method };
}
