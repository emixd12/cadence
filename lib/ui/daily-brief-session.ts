import type {
  DailyBriefResponse,
  DailyBriefSettings,
  DailyBriefing,
} from "@cadence/core/types/daily-brief";
import { DailyBriefRequestError, type DailyBriefClient } from "./daily-brief";

/**
 * Page-session memory for one Daily Brief attempt per client. It lets a
 * remounted launcher reattach to an in-flight request or a fresh result
 * instead of losing it. Generated text stays in memory only.
 */
export type DailyBriefOutcome =
  | Readonly<{ kind: "ready"; briefing: DailyBriefing }>
  | Readonly<{ kind: "already_attempted" }>
  | Readonly<{ kind: "failed"; code: string; retryAfterSeconds?: number; recovery?: string; settledAt: number }>;

export type DailyBriefAttempt = Readonly<{
  accountRef: string;
  localDate: string;
  fence: string;
  sourceKey: string;
  retry: boolean;
  controller: AbortController;
  promise: Promise<DailyBriefOutcome>;
}> & { outcome?: DailyBriefOutcome };

const attemptsByClient = new WeakMap<DailyBriefClient, DailyBriefAttempt>();

/** Account, day, timezone, disclosure and configuration revision fence a remembered attempt. */
export function dailyBriefFence(settings: DailyBriefSettings): string {
  return JSON.stringify([settings.accountRef, settings.localDate, settings.timezone, settings.revision, settings.configurationRevision ?? null]);
}

/** Returns the remembered attempt only when its fence still matches; otherwise discards it. */
export function currentDailyBriefAttempt(client: DailyBriefClient, settings: DailyBriefSettings): DailyBriefAttempt | undefined {
  const attempt = attemptsByClient.get(client);
  if (!attempt) return undefined;
  if (attempt.fence === dailyBriefFence(settings)) return attempt;
  discardDailyBriefAttempt(client);
  return undefined;
}

export function startDailyBriefAttempt(
  client: DailyBriefClient,
  settings: DailyBriefSettings,
  input: Readonly<{ sourceKey: string; retry: boolean; run: (signal: AbortSignal) => Promise<DailyBriefResponse> }>,
): DailyBriefAttempt {
  discardDailyBriefAttempt(client);
  const controller = new AbortController();
  const settle = (outcome: DailyBriefOutcome) => {
    attempt.outcome = outcome;
    return outcome;
  };
  const promise = Promise.resolve().then(() => input.run(controller.signal)).then((response): DailyBriefOutcome => {
    if (response.state === "ready") return { kind: "ready", briefing: response.briefing };
    if (response.state === "already_attempted") return { kind: "already_attempted" };
    return { kind: "failed", code: "pending", ...(response.retryAfterSeconds ? { retryAfterSeconds: response.retryAfterSeconds } : {}), settledAt: Date.now() };
  }, (error: unknown): DailyBriefOutcome => ({
    kind: "failed",
    code: error instanceof DailyBriefRequestError ? error.code : "advisor_unavailable",
    ...(error instanceof DailyBriefRequestError && error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    ...(error instanceof DailyBriefRequestError && error.recovery ? { recovery: error.recovery } : {}),
    settledAt: Date.now(),
  })).then(settle);
  const attempt: DailyBriefAttempt = {
    accountRef: settings.accountRef,
    localDate: settings.localDate,
    fence: dailyBriefFence(settings),
    sourceKey: input.sourceKey,
    retry: input.retry,
    controller,
    promise,
  };
  attemptsByClient.set(client, attempt);
  return attempt;
}

/** Cancels and forgets the remembered attempt, for example after a disclosure or account change. */
export function discardDailyBriefAttempt(client: DailyBriefClient) {
  const attempt = attemptsByClient.get(client);
  if (!attempt) return;
  attemptsByClient.delete(client);
  attempt.controller.abort();
}

let activeClient: DailyBriefClient | null = null;

/**
 * Records the client the launcher now uses. A different client means a changed
 * account or sign-out, so the previous client's attempt is cancelled rather than
 * left consuming an admission for an identity no longer shown.
 */
export function activateDailyBriefClient(client: DailyBriefClient | null) {
  if (activeClient && activeClient !== client) discardDailyBriefAttempt(activeClient);
  activeClient = client;
}

export function isRememberedDailyBriefAttempt(client: DailyBriefClient, attempt: DailyBriefAttempt): boolean {
  return attemptsByClient.get(client) === attempt;
}
