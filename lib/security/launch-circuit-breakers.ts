import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";

export const LAUNCH_CIRCUIT_BREAKER_NAMES = [
  "email_sends",
  "browser_push_sends",
  "reminder_batches",
  "occurrence_sync_batches",
  "export_downloads",
  "leave_reminder_batches",
] as const;

export type LaunchCircuitBreakerName =
  (typeof LAUNCH_CIRCUIT_BREAKER_NAMES)[number];

export type LaunchCircuitBreakerReasonCode =
  | "abuse"
  | "application_regression"
  | "cost_surge"
  | "operator_drill"
  | "provider_incident"
  | "unspecified"
  | "not_open";

export type LaunchCircuitBreakerState = {
  name: LaunchCircuitBreakerName;
  open: boolean;
  reasonCode: LaunchCircuitBreakerReasonCode;
  retryAfterSeconds: number;
};

type LaunchEnvironment = Readonly<Record<string, string | undefined>>;

const BREAKER_ENVIRONMENT_KEYS: Record<LaunchCircuitBreakerName, string> = {
  email_sends: "CADENCE_DISABLE_EMAIL_SENDS",
  browser_push_sends: "CADENCE_DISABLE_BROWSER_PUSH_SENDS",
  reminder_batches: "CADENCE_DISABLE_REMINDER_BATCHES",
  occurrence_sync_batches: "CADENCE_DISABLE_OCCURRENCE_SYNC_BATCHES",
  export_downloads: "CADENCE_DISABLE_EXPORT_DOWNLOADS",
  // Ticket 277: the leave reminder job, before any account is read.
  leave_reminder_batches: "CADENCE_DISABLE_LEAVE_REMINDER_BATCHES",
};

const OPEN_REASON_CODES = new Set<LaunchCircuitBreakerReasonCode>([
  "abuse",
  "application_regression",
  "cost_surge",
  "operator_drill",
  "provider_incident",
]);

const DEFAULT_RETRY_AFTER_SECONDS = 300;

export class LaunchCircuitBreakerOpenError extends Error {
  readonly state: LaunchCircuitBreakerState;

  constructor(state: LaunchCircuitBreakerState) {
    super(`Launch circuit breaker is open: ${state.name}.`);
    this.name = "LaunchCircuitBreakerOpenError";
    this.state = state;
  }
}

export function readLaunchCircuitBreaker(
  name: LaunchCircuitBreakerName,
  environment: LaunchEnvironment = process.env,
): LaunchCircuitBreakerState {
  const open = environment[BREAKER_ENVIRONMENT_KEYS[name]] === "1";

  return {
    name,
    open,
    reasonCode: open
      ? normalizeReasonCode(environment.CADENCE_LAUNCH_BREAKER_REASON_CODE)
      : "not_open",
    retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
  };
}

export function assertLaunchCircuitBreakerClosed(
  name: LaunchCircuitBreakerName,
  environment: LaunchEnvironment = process.env,
): void {
  const state = readLaunchCircuitBreaker(name, environment);

  if (!state.open) {
    return;
  }

  reportOpenLaunchCircuitBreaker(state);
  throw new LaunchCircuitBreakerOpenError(state);
}

export function reportOpenLaunchCircuitBreaker(
  state: LaunchCircuitBreakerState,
  blockedCount = 1,
): void {
  reportMonitoringEvent({
    name: "launch_circuit_breaker_open",
    severity: "warning",
    context: {
      breaker: state.name,
      breaker_state: "open",
      reason_code: state.reasonCode,
      blocked_count: Math.max(0, Math.trunc(blockedCount)),
    },
  });
}

function normalizeReasonCode(
  value: string | undefined,
): LaunchCircuitBreakerReasonCode {
  const normalized = value?.trim() as LaunchCircuitBreakerReasonCode | undefined;

  return normalized && OPEN_REASON_CODES.has(normalized)
    ? normalized
    : "unspecified";
}
