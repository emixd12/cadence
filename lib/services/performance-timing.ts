import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type PerformanceTimingCounts = Record<string, number | null | undefined>;

type PerformanceTimingContext = {
  route: string | null;
};

type PerformanceTimingStatus = "success" | "error";

type PerformanceTimingEvent = {
  source: "cadence";
  kind: "performance_timing";
  route: string | null;
  span: string;
  duration_ms: number;
  status: PerformanceTimingStatus;
  counts?: Record<string, number>;
  error_name?: string;
  error_code?: string;
};

type CountResolver<T> =
  | PerformanceTimingCounts
  | ((result: T) => PerformanceTimingCounts);

const timingContext = new AsyncLocalStorage<PerformanceTimingContext>();
const MAX_NAME_LENGTH = 120;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const SENSITIVE_COUNT_KEY_PARTS = [
  "body",
  "cookie",
  "description",
  "email",
  "endpoint",
  "key",
  "message",
  "note",
  "payload",
  "p256dh",
  "recipient",
  "secret",
  "subscription",
  "title",
  "token",
  "user_agent",
  "uuid",
];

export function isPerformanceTimingEnabled(): boolean {
  return process.env.CADENCE_PERF_LOG === "1";
}

export async function withPerformanceRoute<T>(
  route: string,
  span: string,
  operation: () => Promise<T>,
  options: {
    counts?: CountResolver<T>;
  } = {},
): Promise<T> {
  const safeRoute = sanitizeTimingName(route, "unknown_route");

  return timingContext.run({ route: safeRoute }, () =>
    measurePerformanceSpan(
      {
        route: safeRoute,
        span,
        counts: options.counts,
      },
      operation,
    ),
  );
}

export async function measurePerformanceSpan<T>(
  input: {
    span: string;
    route?: string | null;
    counts?: CountResolver<T>;
  },
  operation: () => Promise<T>,
): Promise<T> {
  if (!isPerformanceTimingEnabled()) {
    return operation();
  }

  const start = performance.now();
  const route =
    input.route === undefined
      ? timingContext.getStore()?.route ?? null
      : input.route;

  try {
    const result = await operation();
    writePerformanceTimingEvent({
      source: "cadence",
      kind: "performance_timing",
      route: route ? sanitizeTimingName(route, "unknown_route") : null,
      span: sanitizeTimingName(input.span, "unknown_span"),
      duration_ms: roundDuration(performance.now() - start),
      status: "success",
      counts: resolveCounts(input.counts, result),
    });

    return result;
  } catch (error) {
    writePerformanceTimingEvent({
      source: "cadence",
      kind: "performance_timing",
      route: route ? sanitizeTimingName(route, "unknown_route") : null,
      span: sanitizeTimingName(input.span, "unknown_span"),
      duration_ms: roundDuration(performance.now() - start),
      status: "error",
      error_name: safeErrorName(error),
      ...safeErrorCode(error),
    });

    throw error;
  }
}

function writePerformanceTimingEvent(event: PerformanceTimingEvent): void {
  console.info(JSON.stringify(event));
}

function resolveCounts<T>(
  counts: CountResolver<T> | undefined,
  result: T,
): Record<string, number> | undefined {
  if (!counts) {
    return undefined;
  }

  const rawCounts = typeof counts === "function" ? counts(result) : counts;
  const safeCounts = sanitizeCounts(rawCounts);

  return Object.keys(safeCounts).length > 0 ? safeCounts : undefined;
}

function sanitizeCounts(
  counts: PerformanceTimingCounts,
): Record<string, number> {
  const safeCounts: Record<string, number> = {};

  for (const [key, value] of Object.entries(counts)) {
    if (value === null || value === undefined || isSensitiveCountKey(key)) {
      continue;
    }

    if (!Number.isFinite(value)) {
      continue;
    }

    const safeKey = sanitizeCountKey(key);

    if (!safeKey) {
      continue;
    }

    safeCounts[safeKey] = Math.round(value);
  }

  return safeCounts;
}

function sanitizeTimingName(value: string, fallback: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed
    .replace(UUID_PATTERN, "_id_")
    .replace(/[^a-zA-Z0-9_./:-]/g, "_")
    .slice(0, MAX_NAME_LENGTH);
}

function sanitizeCountKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, MAX_NAME_LENGTH);
}

function isSensitiveCountKey(key: string): boolean {
  const normalized = sanitizeCountKey(key);

  return SENSITIVE_COUNT_KEY_PARTS.some((part) => normalized.includes(part));
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Only short machine codes such as `timeout`; never messages or provider bodies. */
function safeErrorCode(error: unknown): { error_code?: string } {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(code) ? { error_code: code } : {};
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name;
  }

  return "UnknownError";
}
