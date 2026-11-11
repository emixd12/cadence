import { InMemoryRateLimiter } from "@/lib/security/rate-limiter";

const AUTH_FAILURE_LIMIT = 5;
const AUTH_FAILURE_WINDOW_MS = 60_000;
const UNKNOWN_CLIENT_IP = "unknown";

export const pushSubscribeAuthFailureLimiter = new InMemoryRateLimiter({
  maxAttempts: AUTH_FAILURE_LIMIT,
  windowMs: AUTH_FAILURE_WINDOW_MS,
});

export const reminderProcessAuthFailureLimiter = new InMemoryRateLimiter({
  maxAttempts: AUTH_FAILURE_LIMIT,
  windowMs: AUTH_FAILURE_WINDOW_MS,
});

export const occurrenceSyncAuthFailureLimiter = new InMemoryRateLimiter({
  maxAttempts: AUTH_FAILURE_LIMIT,
  windowMs: AUTH_FAILURE_WINDOW_MS,
});

/** Ticket 277: the leave reminder job's cron route. */
export const leaveReminderProcessAuthFailureLimiter = new InMemoryRateLimiter({
  maxAttempts: AUTH_FAILURE_LIMIT,
  windowMs: AUTH_FAILURE_WINDOW_MS,
});

/** Ticket 307: the one-off Daily Brief Calendar grant retirement route. */
export const agentCalendarRetirementAuthFailureLimiter = new InMemoryRateLimiter({
  maxAttempts: AUTH_FAILURE_LIMIT,
  windowMs: AUTH_FAILURE_WINDOW_MS,
});

export function buildAuthFailureRateLimitKey(
  scope: string,
  headers: Pick<Headers, "get">,
): string {
  return `${scope}:${getClientIp(headers)}`;
}

export function resetAuthFailureRateLimitersForTests(): void {
  pushSubscribeAuthFailureLimiter.clear();
  reminderProcessAuthFailureLimiter.clear();
  occurrenceSyncAuthFailureLimiter.clear();
  leaveReminderProcessAuthFailureLimiter.clear();
  agentCalendarRetirementAuthFailureLimiter.clear();
}

export function getClientIp(headers: Pick<Headers, "get">): string {
  return (
    firstHeaderValue(headers.get("cf-connecting-ip")) ??
    firstHeaderValue(headers.get("x-real-ip")) ??
    firstHeaderValue(headers.get("x-forwarded-for")) ??
    UNKNOWN_CLIENT_IP
  );
}

function firstHeaderValue(value: string | null): string | null {
  const firstValue = value?.split(",")[0]?.trim();

  return firstValue || null;
}
