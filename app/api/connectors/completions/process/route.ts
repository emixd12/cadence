import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { reportMonitoringError, reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  buildAuthFailureRateLimitKey,
  connectorCompletionProcessAuthFailureLimiter,
} from "@/lib/security/auth-failure-rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { connectorCompletionEnabled } from "@/lib/services/connector-completion.service";
import {
  createHostedCompletionAccountPort,
  hostedDueCompletionAccountSelection,
  processConnectorCompletions,
} from "@/lib/services/connector-completion-job.service";

// Ticket 321 (D28.5): the background connector completion job. Vercel Cron calls it
// at minutes 7, 22, 37 and 52 with `Authorization: Bearer $CRON_SECRET`. It does
// nothing until CADENCE_CONNECTOR_COMPLETION is exactly "on". Responses and
// monitoring carry counts only: no titles, activity references or tokens.

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/connectors/completions/process";
const RATE_LIMIT_SCOPE = "connector-completion-process-auth";

export async function GET(request: NextRequest) {
  return processRequest(request);
}

export async function POST(request: NextRequest) {
  return processRequest(request);
}

async function processRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    reportMonitoringEvent({ name: "connector_completion_process_not_configured", severity: "error", context: routeContext(request) });
    return jsonError("Connector completion processing is not configured.", 503);
  }
  const rateLimitKey = buildAuthFailureRateLimitKey(RATE_LIMIT_SCOPE, request.headers);
  const rateLimit = connectorCompletionProcessAuthFailureLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) {
    return jsonError("Too many failed attempts. Try again later.", 429, rateLimit.retryAfterSeconds);
  }
  if (!secretMatches(readBearer(request), cronSecret)) {
    const failure = connectorCompletionProcessAuthFailureLimiter.recordFailure(rateLimitKey);
    reportMonitoringEvent({ name: "connector_completion_process_unauthorized", severity: "warning", context: routeContext(request) });
    return failure.allowed
      ? jsonError("Unauthorized connector completion processing request.", 401)
      : jsonError("Too many failed attempts. Try again later.", 429, failure.retryAfterSeconds);
  }
  connectorCompletionProcessAuthFailureLimiter.reset(rateLimitKey);

  if (!connectorCompletionEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, result: null });
  }
  try {
    const result = await processConnectorCompletions({
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
      selectDueAccounts: hostedDueCompletionAccountSelection(createServiceRoleClient()),
      openAccount: (account, now) => createHostedCompletionAccountPort(account, now),
    });
    reportMonitoringEvent({ name: "connector_completion_process_completed", context: { ...routeContext(request), ...result } });
    return NextResponse.json({ ok: true, enabled: true, result });
  } catch (error) {
    reportMonitoringError("connector_completion_process_failed", error, routeContext(request));
    return jsonError("Unable to process connector completions.", 500);
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
