import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { agentCallerConfigured } from "@/lib/integrations/agent-caller";
import { reportMonitoringError, reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  buildAuthFailureRateLimitKey,
  coachSignalsProcessAuthFailureLimiter,
} from "@/lib/security/auth-failure-rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  coachSignalsEnabled,
  createHostedCoachVisitPort,
  hostedDueCoachAccounts,
  processCoachSignals,
  visitCoachAccount,
} from "@/lib/services/coach-signals-job.service";

// Advisor plan Phase 3, workstream 3D: coach signals in shadow. Vercel Cron calls this
// hourly with `Authorization: Bearer $CRON_SECRET`. It visits accounts where it is
// early morning local time and stores their signals; nothing is shown. Set
// CADENCE_COACH_SIGNALS=off to stop it. Responses and monitoring carry counts only.

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/advisor/coach/signals/process";
const RATE_LIMIT_SCOPE = "coach-signals-process-auth";

export async function GET(request: NextRequest) {
  return processRequest(request);
}

export async function POST(request: NextRequest) {
  return processRequest(request);
}

async function processRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    reportMonitoringEvent({ name: "coach_signals_process_not_configured", severity: "error", context: routeContext(request) });
    return jsonError("Coach signal processing is not configured.", 503);
  }
  const rateLimitKey = buildAuthFailureRateLimitKey(RATE_LIMIT_SCOPE, request.headers);
  const rateLimit = coachSignalsProcessAuthFailureLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) {
    return jsonError("Too many failed attempts. Try again later.", 429, rateLimit.retryAfterSeconds);
  }
  if (!secretMatches(readBearer(request), cronSecret)) {
    const failure = coachSignalsProcessAuthFailureLimiter.recordFailure(rateLimitKey);
    reportMonitoringEvent({ name: "coach_signals_process_unauthorized", severity: "warning", context: routeContext(request) });
    return failure.allowed
      ? jsonError("Unauthorized coach signal processing request.", 401)
      : jsonError("Too many failed attempts. Try again later.", 429, failure.retryAfterSeconds);
  }
  coachSignalsProcessAuthFailureLimiter.reset(rateLimitKey);

  if (!coachSignalsEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, result: null });
  }
  try {
    if (!agentCallerConfigured()) {
      reportMonitoringEvent({ name: "coach_signals_process_not_configured", severity: "error", context: routeContext(request) });
      return jsonError("Coach signal processing is not configured.", 503);
    }
    const result = await processCoachSignals({
      selectDue: hostedDueCoachAccounts(createServiceRoleClient()),
      visit: (account) => visitCoachAccount(createHostedCoachVisitPort(account.userId)),
    });
    reportMonitoringEvent({ name: "coach_signals_process_completed", context: { ...routeContext(request), ...result } });
    return NextResponse.json({ ok: true, enabled: true, result });
  } catch (error) {
    reportMonitoringError("coach_signals_process_failed", error, routeContext(request));
    return jsonError("Unable to process coach signals.", 500);
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
    headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
  });
}

function routeContext(request: NextRequest) {
  return { route: ROUTE, method: request.method };
}
