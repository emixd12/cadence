import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { sanitizeGoogleCalendarText } from "@/lib/services/google-calendar-provider";
import {
  ProviderCallTimeoutError,
  runProviderCallWithTimeout,
} from "@/lib/services/provider-call-timeout";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

export const MODEL_ARMOR_REDACTED_PLACEHOLDER = "[filtered calendar text]";
const DEFAULT_MODEL_ARMOR_PROJECT = "cadence-calendar-agent-prod";
const DEFAULT_MODEL_ARMOR_TIMEOUT_MS = 4_000;

export type ModelArmorFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ModelArmorConfig = Readonly<{
  template: string;
  location: string;
  project: string;
}>;

export type ModelArmorScreenTextInput = Readonly<{
  text: string;
  maximumLength?: number;
  html?: boolean;
  env?: NodeJS.ProcessEnv;
  accessToken?: string;
  getAccessToken?: () => Promise<string | null>;
  fetch?: ModelArmorFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  failClosed?: boolean;
  emitMonitoringEvent?: boolean;
  reportEvent?: typeof reportMonitoringEvent;
}>;

export type ModelArmorScreenTextResult = Readonly<{
  text: string;
  blocked: boolean;
  screenedBy: "model_armor" | "in_app_fallback";
  errorCode?: "missing_access_token" | "timeout" | "http_error" | "network_error" | "malformed_response";
}>;

export type ModelArmorScreenSnapshotOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  accessToken?: string;
  getAccessToken?: () => Promise<string | null>;
  fetch?: ModelArmorFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  failClosed?: boolean;
  reportEvent?: typeof reportMonitoringEvent;
}>;

export type ModelArmorScreenSnapshotResult = Readonly<{
  snapshot: ExternalEventSnapshotV1;
  blockedCount: number;
  screenedBy: "model_armor" | "in_app_fallback";
}>;

function readEnvVar(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function resolveModelArmorConfig(
  sourceEnv: NodeJS.ProcessEnv = process.env,
): ModelArmorConfig | null {
  const rawTemplate = readEnvVar(sourceEnv, "CADENCE_MODEL_ARMOR_TEMPLATE");
  const location = readEnvVar(sourceEnv, "CADENCE_MODEL_ARMOR_LOCATION");
  if (!rawTemplate || !location) return null;

  const project = readEnvVar(sourceEnv, "CADENCE_MODEL_ARMOR_PROJECT") ?? DEFAULT_MODEL_ARMOR_PROJECT;
  const template = rawTemplate.startsWith("projects/")
    ? rawTemplate
    : `projects/${project}/locations/${location}/templates/${rawTemplate}`;

  return { template, location, project };
}

export function isModelArmorConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveModelArmorConfig(env) !== null;
}

export async function screenExternalCalendarTextWithModelArmor(
  input: ModelArmorScreenTextInput,
): Promise<ModelArmorScreenTextResult> {
  const sanitized = sanitizeGoogleCalendarText(
    input.text,
    input.maximumLength ?? 2_048,
    input.html ?? false,
  );
  if (!sanitized) {
    return {
      text: "",
      blocked: false,
      screenedBy: isModelArmorConfigured(input.env) ? "model_armor" : "in_app_fallback",
    };
  }

  const config = resolveModelArmorConfig(input.env);
  if (!config) {
    return {
      text: sanitized,
      blocked: false,
      screenedBy: "in_app_fallback",
    };
  }

  const emitEvent = input.reportEvent ?? reportMonitoringEvent;
  const shouldEmit = input.emitMonitoringEvent ?? true;

  const accessToken = input.accessToken
    ?? (input.getAccessToken ? await input.getAccessToken() : null)
    ?? readEnvVar(input.env ?? process.env, "CADENCE_MODEL_ARMOR_ACCESS_TOKEN")
    ?? null;

  if (!accessToken) {
    emitEvent({
      name: "model_armor_screening_failed",
      severity: "warning",
      context: { reason: "missing_access_token" },
    });
    return input.failClosed
      ? { text: MODEL_ARMOR_REDACTED_PLACEHOLDER, blocked: true, screenedBy: "in_app_fallback", errorCode: "missing_access_token" }
      : { text: sanitized, blocked: false, screenedBy: "in_app_fallback", errorCode: "missing_access_token" };
  }

  const endpoint = `https://modelarmor.${config.location}.rep.googleapis.com/v1/${config.template}:sanitizeUserPrompt`;
  const fetcher = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_MODEL_ARMOR_TIMEOUT_MS;

  let response: Response;
  try {
    const providerSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
      : undefined;
    response = await runProviderCallWithTimeout(
      (signal) => fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userPromptData: {
            text: sanitized,
          },
        }),
        signal,
      }),
      { timeoutMs, signal: providerSignal },
    );
  } catch (error) {
    const isTimeout = error instanceof ProviderCallTimeoutError || Boolean(input.signal?.aborted);
    const errorCode = isTimeout ? "timeout" : "network_error";
    emitEvent({
      name: "model_armor_screening_failed",
      severity: "warning",
      context: { reason: errorCode },
    });
    return input.failClosed
      ? { text: MODEL_ARMOR_REDACTED_PLACEHOLDER, blocked: true, screenedBy: "in_app_fallback", errorCode }
      : { text: sanitized, blocked: false, screenedBy: "in_app_fallback", errorCode };
  }

  if (!response.ok) {
    emitEvent({
      name: "model_armor_screening_failed",
      severity: "warning",
      context: { reason: "http_error", status: response.status },
    });
    return input.failClosed
      ? { text: MODEL_ARMOR_REDACTED_PLACEHOLDER, blocked: true, screenedBy: "in_app_fallback", errorCode: "http_error" }
      : { text: sanitized, blocked: false, screenedBy: "in_app_fallback", errorCode: "http_error" };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    emitEvent({
      name: "model_armor_screening_failed",
      severity: "warning",
      context: { reason: "malformed_response" },
    });
    return input.failClosed
      ? { text: MODEL_ARMOR_REDACTED_PLACEHOLDER, blocked: true, screenedBy: "in_app_fallback", errorCode: "malformed_response" }
      : { text: sanitized, blocked: false, screenedBy: "in_app_fallback", errorCode: "malformed_response" };
  }

  const matched = isModelArmorMatchFound(parsed);
  if (matched) {
    if (shouldEmit) {
      emitEvent({
        name: "model_armor_prompt_injection_blocked",
        severity: "warning",
        context: { count: 1 },
      });
    }
    return {
      text: MODEL_ARMOR_REDACTED_PLACEHOLDER,
      blocked: true,
      screenedBy: "model_armor",
    };
  }

  return {
    text: sanitized,
    blocked: false,
    screenedBy: "model_armor",
  };
}

export async function screenSnapshotWithModelArmor(
  snapshot: ExternalEventSnapshotV1,
  options: ModelArmorScreenSnapshotOptions = {},
): Promise<ModelArmorScreenSnapshotResult> {
  if (!isModelArmorConfigured(options.env)) {
    return {
      snapshot,
      blockedCount: 0,
      screenedBy: "in_app_fallback",
    };
  }

  const emitEvent = options.reportEvent ?? reportMonitoringEvent;
  let blockedCount = 0;
  let anyModelArmorCall = false;

  const screenedEvents: NormalizedExternalEvent[] = [];
  for (const event of snapshot.events) {
    const [titleResult, locationResult, calendarNameResult] = await Promise.all([
      event.title
        ? screenExternalCalendarTextWithModelArmor({
            text: event.title,
            maximumLength: 1_024,
            html: false,
            env: options.env,
            accessToken: options.accessToken,
            getAccessToken: options.getAccessToken,
            fetch: options.fetch,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            failClosed: options.failClosed,
            emitMonitoringEvent: false,
            reportEvent: emitEvent,
          })
        : Promise.resolve<ModelArmorScreenTextResult>({ text: "", blocked: false, screenedBy: "model_armor" }),
      event.location
        ? screenExternalCalendarTextWithModelArmor({
            text: event.location,
            maximumLength: 2_048,
            html: false,
            env: options.env,
            accessToken: options.accessToken,
            getAccessToken: options.getAccessToken,
            fetch: options.fetch,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            failClosed: options.failClosed,
            emitMonitoringEvent: false,
            reportEvent: emitEvent,
          })
        : Promise.resolve<ModelArmorScreenTextResult>({ text: "", blocked: false, screenedBy: "model_armor" }),
      event.calendarName
        ? screenExternalCalendarTextWithModelArmor({
            text: event.calendarName,
            maximumLength: 1_024,
            html: false,
            env: options.env,
            accessToken: options.accessToken,
            getAccessToken: options.getAccessToken,
            fetch: options.fetch,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            failClosed: options.failClosed,
            emitMonitoringEvent: false,
            reportEvent: emitEvent,
          })
        : Promise.resolve<ModelArmorScreenTextResult>({ text: event.calendarName, blocked: false, screenedBy: "model_armor" }),
    ]);

    if (
      titleResult.screenedBy === "model_armor" ||
      locationResult.screenedBy === "model_armor" ||
      calendarNameResult.screenedBy === "model_armor"
    ) {
      anyModelArmorCall = true;
    }

    if (titleResult.blocked) blockedCount += 1;
    if (locationResult.blocked) blockedCount += 1;
    if (calendarNameResult.blocked) blockedCount += 1;

    screenedEvents.push({
      ...event,
      title: titleResult.text,
      location: locationResult.text,
      calendarName: calendarNameResult.text || MODEL_ARMOR_REDACTED_PLACEHOLDER,
    });
  }

  if (blockedCount > 0) {
    emitEvent({
      name: "model_armor_prompt_injection_blocked",
      severity: "warning",
      context: { count: blockedCount },
    });
  }

  return {
    snapshot: {
      ...snapshot,
      events: screenedEvents,
    },
    blockedCount,
    screenedBy: anyModelArmorCall || snapshot.events.length === 0 ? "model_armor" : "in_app_fallback",
  };
}

function isModelArmorMatchFound(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const root = payload as Record<string, unknown>;
  const sanitizationResult = root.sanitizationResult;
  if (!sanitizationResult || typeof sanitizationResult !== "object" || Array.isArray(sanitizationResult)) {
    return false;
  }
  const result = sanitizationResult as Record<string, unknown>;
  if (result.filterMatchState === "MATCH_FOUND") {
    return true;
  }
  const filterResults = result.filterResults;
  if (filterResults && typeof filterResults === "object" && !Array.isArray(filterResults)) {
    for (const entry of Object.values(filterResults as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      for (const nested of Object.values(entry as Record<string, unknown>)) {
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          if ((nested as Record<string, unknown>).matchState === "MATCH_FOUND") {
            return true;
          }
        }
      }
    }
  }
  return false;
}
