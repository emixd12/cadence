import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { reportMonitoringError, reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  agentCalendarRetirementAuthFailureLimiter,
  buildAuthFailureRateLimitKey,
} from "@/lib/security/auth-failure-rate-limits";
import { retireDailyBriefCalendarGrants } from "@/lib/services/google-calendar-agent-retirement.service";

// Ticket 307: one-off retirement of the Daily Brief Google Calendar grants. The operator
// calls it with `Authorization: Bearer $GOOGLE_CALENDAR_AGENT_RETIRE_SECRET` before pushing
// migration 20261110160000 (docs/OPERATIONS.md, "Retiring the Daily Brief Calendar grant").
// It has its own secret, not CRON_SECRET, so the caller gets no access to the cron routes,
// and the secret is deleted once retirement finishes. It is not scheduled. Each call
// handles up to 100 grants and is safe to repeat.

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/google-calendar/agent-grants/retire";
const RATE_LIMIT_SCOPE = "agent-calendar-retirement-auth";

export async function POST(request: NextRequest) {
  const retireSecret = process.env.GOOGLE_CALENDAR_AGENT_RETIRE_SECRET?.trim();
  if (!retireSecret) return jsonError("Calendar grant retirement is not configured.", 503);

  const rateLimitKey = buildAuthFailureRateLimitKey(RATE_LIMIT_SCOPE, request.headers);
  const rateLimit = agentCalendarRetirementAuthFailureLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) return jsonError("Too many failed attempts. Try again later.", 429, rateLimit.retryAfterSeconds);
  if (!secretMatches(readBearer(request), retireSecret)) {
    const failure = agentCalendarRetirementAuthFailureLimiter.recordFailure(rateLimitKey);
    reportMonitoringEvent({ name: "agent_calendar_retirement_unauthorized", severity: "warning", context: { route: ROUTE } });
    return failure.allowed
      ? jsonError("Unauthorized Calendar grant retirement request.", 401)
      : jsonError("Too many failed attempts. Try again later.", 429, failure.retryAfterSeconds);
  }
  agentCalendarRetirementAuthFailureLimiter.reset(rateLimitKey);

  try {
    const result = await retireDailyBriefCalendarGrants();
    reportMonitoringEvent({ name: "agent_calendar_retirement_completed", context: { route: ROUTE, ...result } });
    return NextResponse.json({ ok: result.state === "complete", result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportMonitoringError("agent_calendar_retirement_failed", error, { route: ROUTE });
    return jsonError("Calendar grant retirement could not finish.", 500);
  }
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

function jsonError(message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json({ ok: false, error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}) },
  });
}
