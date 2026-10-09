import type {
  DailyBriefResponse,
  DailyBriefSettings,
} from "@cadence/core/types/daily-brief";
import type { TimelineView } from "@cadence/core/types/timeline";

export function timelineBriefKey(timeline: TimelineView): string {
  return JSON.stringify([
    timeline.timezone, timeline.todayLocalDate, timeline.durationEstimates,
    [...timeline.daySections, ...timeline.needsDecision.daySections].map((section) =>
      section.occurrences.map((occurrence) => [occurrence.id, occurrence.title,
        occurrence.scheduledFor, occurrence.status, occurrence.statusMarkedAt, occurrence.timeTracking])),
  ]);
}

export type DailyBriefClient = Readonly<{
  preferences: (signal?: AbortSignal) => Promise<DailyBriefSettings>;
  updatePreferences: (
    input: DailyBriefPreferenceInput,
    signal?: AbortSignal,
  ) => Promise<DailyBriefSettings>;
  requestBrief: (
    input: Readonly<{ installationId: string; retry: boolean }>,
    signal?: AbortSignal,
  ) => Promise<DailyBriefResponse>;
}>;

export type DailyBriefPreferenceInput = Readonly<{
  enabled: boolean;
  includeCalendar: boolean;
  includeReminderHistory?: boolean;
  includeNotes?: boolean;
}>;

export class DailyBriefRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
    public readonly recovery?: string,
  ) {
    super(code);
    this.name = "DailyBriefRequestError";
  }
}

/** Client ceilings. The server keeps its 60-second attempt and 30-second phases. */
export const DAILY_BRIEF_CLIENT_DEADLINES = Object.freeze({
  preferencesMs: 15_000,
  installationMs: 5_000,
  briefMs: 75_000,
});

export function createWebDailyBriefClient(fetcher: typeof fetch = fetch): DailyBriefClient {
  return {
    preferences: (signal) => dailyBriefFetch<DailyBriefSettings>(fetcher, "/api/advisor/preferences", {}, {
      signal, deadlineMs: DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs,
    }),
    updatePreferences: (input, signal) => dailyBriefFetch<DailyBriefSettings>(fetcher, "/api/advisor/preferences", {
      method: "PUT",
      body: JSON.stringify(input),
    }, { signal, deadlineMs: DAILY_BRIEF_CLIENT_DEADLINES.preferencesMs }),
    requestBrief: (input, signal) => dailyBriefFetch<DailyBriefResponse>(fetcher, "/api/advisor/brief", {
      method: "POST",
      body: JSON.stringify(input),
    }, { signal, deadlineMs: DAILY_BRIEF_CLIENT_DEADLINES.briefMs }),
  };
}

let webClient: DailyBriefClient | undefined;
/** One web client per page session, so remounted launchers share the remembered attempt. */
export function defaultWebDailyBriefClient(): DailyBriefClient {
  webClient ??= createWebDailyBriefClient();
  return webClient;
}

/**
 * Runs `work` under a deadline composed with the caller's signal. A caller
 * signal never disables the deadline, and an unresolved promise still settles.
 */
export function withDailyBriefDeadline<T>(
  deadlineMs: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const stop = (error: DailyBriefRequestError) => {
      if (controller.signal.aborted) return;
      cleanup();
      controller.abort(error);
      reject(error);
    };
    const cancel = () => stop(new DailyBriefRequestError("cancelled"));
    const timer = setTimeout(() => stop(new DailyBriefRequestError("timeout")), deadlineMs);
    function cleanup() { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
    if (signal?.aborted) { cleanup(); cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    let running: Promise<T>;
    try { running = work(controller.signal); } catch (error) { running = Promise.reject(error); }
    running.then((value) => {
      if (!controller.signal.aborted) resolve(value);
    }, (error: unknown) => {
      if (!controller.signal.aborted) reject(error);
    }).finally(cleanup);
  });
}

/** Shared web/desktop transport: bounded request and body decoding, sanitized codes. */
export function dailyBriefFetch<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  options: Readonly<{
    signal?: AbortSignal;
    deadlineMs: number;
    headers?: () => Promise<Record<string, string>>;
  }>,
): Promise<T> {
  return withDailyBriefDeadline(options.deadlineMs, options.signal, async (signal) => {
    const extraHeaders = options.headers ? await options.headers() : {};
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        cache: "no-store",
        signal,
        headers: {
          ...extraHeaders,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new DailyBriefRequestError(isOffline() ? "offline" : "brief_unavailable");
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const details = body && typeof body === "object" ? body as { error?: unknown; retryAfterSeconds?: unknown; recovery?: unknown } : {};
      throw new DailyBriefRequestError(
        typeof details.error === "string" ? details.error : "brief_unavailable",
        typeof details.retryAfterSeconds === "number" && Number.isFinite(details.retryAfterSeconds) && details.retryAfterSeconds > 0
          ? details.retryAfterSeconds : undefined,
        typeof details.recovery === "string" ? details.recovery : undefined,
      );
    }
    return body as T;
  });
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function dailyBriefInstallationId(
  storage: Storage = window.localStorage,
  signal?: AbortSignal,
): Promise<string> {
  return withDailyBriefDeadline(DAILY_BRIEF_CLIENT_DEADLINES.installationMs, signal, async (bounded) => {
    if ("locks" in navigator) {
      return navigator.locks.request("cadence.daily-brief.installation.v1", { mode: "exclusive", signal: bounded }, () => installationId(storage));
    }
    return installationId(storage);
  });
}

function installationId(storage: Storage): string {
  const key = "cadence.daily-brief.installation.v1";
  const current = storage.getItem(key);
  if (current) return current;
  const installationId = crypto.randomUUID();
  storage.setItem(key, installationId);
  return installationId;
}

/**
 * Per account/day/installation presentation markers. `attempted` records the
 * automatic start, `delivered` records that ready text reached this browser,
 * and `pendingUntil` bounds another tab's claim on the in-flight attempt.
 * No generated text or source facts are stored.
 */
export type DailyBriefPresentation = Readonly<{
  attempted: boolean;
  delivered: boolean;
  dismissed: boolean;
  pendingUntil?: number;
}>;

export function readDailyBriefPresentation(
  accountRef: string,
  localDate: string,
  storage: Storage = window.localStorage,
): DailyBriefPresentation {
  try {
    pruneDailyBriefPresentation(storage, accountRef, localDate);
    const value = JSON.parse(storage.getItem(presentationKey(accountRef, localDate)) ?? "{}") as Record<string, unknown>;
    const attempted = value.attempted === true;
    return {
      attempted,
      // Markers written before recovery existed did not record delivery; treat them as delivered.
      delivered: typeof value.delivered === "boolean" ? value.delivered : attempted,
      dismissed: value.dismissed === true,
      ...(typeof value.pendingUntil === "number" && Number.isFinite(value.pendingUntil) ? { pendingUntil: value.pendingUntil } : {}),
    };
  } catch {
    return { attempted: false, delivered: false, dismissed: false };
  }
}

export function markDailyBriefPresentation(
  accountRef: string,
  localDate: string,
  value: DailyBriefPresentation,
  storage: Storage = window.localStorage,
) {
  pruneDailyBriefPresentation(storage, accountRef, localDate);
  storage.setItem(presentationKey(accountRef, localDate), JSON.stringify({
    attempted: value.attempted,
    delivered: value.delivered,
    dismissed: value.dismissed,
    ...(value.pendingUntil === undefined ? {} : { pendingUntil: value.pendingUntil }),
  }));
}

export function isDailyBriefPresentationKey(key: string | null): boolean {
  return !!key?.startsWith("cadence.daily-brief.presentation.v1:");
}

function presentationKey(accountRef: string, localDate: string) {
  return `cadence.daily-brief.presentation.v1:${accountRef}:${localDate}`;
}

function pruneDailyBriefPresentation(storage: Storage, accountRef: string, localDate: string) {
  const prefix = "cadence.daily-brief.presentation.v1:";
  const current = presentationKey(accountRef, localDate);
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && key !== current) storage.removeItem(key);
  }
}
