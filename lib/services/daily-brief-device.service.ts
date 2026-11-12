import { Temporal } from "@js-temporal/polyfill";
import { DAILY_BRIEF_RECIPE } from "@cadence/core/types/briefing-config";
import type { DailyBriefResponse } from "@cadence/core/types/daily-brief";
import { beginDailyBrief, finishDailyBrief, releaseDailyBrief, readDailyBriefPreferences, readDailyBriefTipHistory, recordDailyBriefTip } from "@/lib/db/daily-brief.repo";
import { briefingAccountRef, readBriefingContextFence } from "./briefing-account-context.service";
import { activeBriefingConfig, briefingConfigurationRevision } from "./briefing-pipeline";
import { assertBriefContextFresh, DailyBriefError, prepareDailyBrief, raceBriefAbort, validateDailyBrief, type DailyBriefModelRequest } from "./daily-brief-consumer";
import {
  dailyBriefDeviceModelAvailable, issueDailyBriefEnvelope, MAX_DAILY_BRIEF_ENVELOPE_LENGTH, MAX_DAILY_BRIEF_ENVELOPE_TTL_SECONDS,
  readDailyBriefEnvelopeSecrets, verifyDailyBriefEnvelope,
} from "./daily-brief-device-envelope";
import { captureLiveDailyBriefContext, DAILY_BRIEF_INSTALLATION_ID, readDailyBriefAttemptInput } from "./daily-brief.service";
import type { CalendarCaller } from "./google-calendar.service";
import { measurePerformanceSpan } from "./performance-timing";

/**
 * Ticket 298 (decision D27): the Daily Brief for a model the device runs. Prepare runs
 * today's admission, context and freshness steps and returns the model request with a
 * signed envelope. The device runs the model call on the user's ChatGPT plan. Complete
 * verifies the envelope and the lease, validates the output, finishes the lease and
 * records the tip. Cadence's server makes no model call on this path: neither the
 * brief nor a duration estimate.
 *
 * Time budget. `begin_daily_brief` holds a lease for 75 seconds. Prepare gets 35 seconds,
 * with provider reads ending 5 seconds before that. The envelope expires when the lease
 * does, counted from just before admission, so it never outlives the lease. That leaves
 * the device at least 40 seconds for the model call (the hosted path allows 30) and the
 * complete request.
 */
export const DAILY_BRIEF_DEVICE_PREPARE_DEADLINE_MS = 35_000;
export const DAILY_BRIEF_DEVICE_PREPARE_RESERVE_MS = 5_000;
export const DAILY_BRIEF_DEVICE_COMPLETE_DEADLINE_MS = 20_000;
/** Envelope plus the model reply (64 KiB at most on the device) and JSON framing. */
export const DAILY_BRIEF_DEVICE_COMPLETE_MAX_BYTES = MAX_DAILY_BRIEF_ENVELOPE_LENGTH + 80_000;

export type DailyBriefDevicePrepareResponse =
  | Readonly<{ state: "prepared"; request: DailyBriefModelRequest; envelope: string; expiresAt: string }>
  | Exclude<DailyBriefResponse, Readonly<{ state: "ready" }>>;

type DeviceOptions = Readonly<{ now?: () => Temporal.Instant; deadlineMs?: number }>;

/** Phase diagnostics record span, duration and error code only; never prompts, facts, output or envelopes. */
const phase = <T,>(span: string, operation: () => Promise<T>) => measurePerformanceSpan({ span: `daily_brief.device.${span}` }, operation);

/** Device mode supports recipe 1.0 only: later recipes may call the estimate step, which only the server can run today. */
function deviceConfiguration() {
  const configuration = activeBriefingConfig();
  if (configuration.recipe.id !== DAILY_BRIEF_RECIPE.id || configuration.recipe.version !== DAILY_BRIEF_RECIPE.version) {
    throw new DailyBriefError("device_recipe_unsupported");
  }
  return configuration;
}

function deviceSecret(): string {
  const env = process.env;
  const secret = readDailyBriefEnvelopeSecrets(env).current;
  if (!dailyBriefDeviceModelAvailable(env) || !secret) throw new DailyBriefError("not_configured");
  return secret;
}

export async function prepareDeviceDailyBrief(caller: CalendarCaller, value: unknown, options: DeviceOptions = {}): Promise<DailyBriefDevicePrepareResponse> {
  const secret = deviceSecret();
  const attempt = readDailyBriefAttemptInput(value);
  const configuration = deviceConfiguration();
  const configurationRevision = briefingConfigurationRevision(configuration);
  const clock = options.now ?? (() => Temporal.Now.instant());
  const deadlineMs = options.deadlineMs ?? DAILY_BRIEF_DEVICE_PREPARE_DEADLINE_MS;
  const sourceDeadlineAt = Date.now() + deadlineMs - DAILY_BRIEF_DEVICE_PREPARE_RESERVE_MS;
  const signal = AbortSignal.timeout(deadlineMs);
  const { installationId } = attempt;
  const work = async (): Promise<DailyBriefDevicePrepareResponse> => {
    const preferences = await phase("preferences", () => readDailyBriefPreferences(caller.client, signal));
    signal.throwIfAborted();
    if (!preferences.enabled) throw new DailyBriefError("access_denied");
    // Read before admission, so the envelope expires no later than the lease the database sets.
    const admittedAt = clock();
    const admission = await phase("admission", () => beginDailyBrief(caller.client, { installationId, retry: attempt.retry, expectedRevision: preferences.revision }, signal));
    if (admission.state === "rate_limited") throw new DailyBriefError("rate_limited", admission.retryAfterSeconds);
    if (admission.state === "retry_exhausted") throw new DailyBriefError("retry_exhausted");
    if (admission.state === "pending") return admission.retryAfterSeconds ? { state: "pending", retryAfterSeconds: admission.retryAfterSeconds } : { state: "pending" };
    if (admission.state !== "acquired") return { state: admission.state };
    const leaseToken = admission.leaseToken;
    let handedOff = false;
    try {
      signal.throwIfAborted();
      const prepared = await phase("context", () => captureLiveDailyBriefContext(caller, {
        configuration, preferences, localDate: admission.localDate, travelConclusions: attempt.travelConclusions, sourceDeadlineAt, signal, clock,
      }));
      const context = prepared.contexts[0]!;
      const shown = configuration.analysis.maxTips ? await phase("tip_history", () => readDailyBriefTipHistory(caller.client, signal)) : [];
      // No `estimate` generator and no `descriptions`: the server never calls a model here.
      const { request, validation } = await phase("prepare", () => prepareDailyBrief(context, { config: configuration, now: clock, signal,
        analysis: { source: prepared.analysisSource, shown, fingerprintOf: prepared.tipFingerprint } }));
      // Read the fence first, then confirm the capture is still current, so the digest describes the inputs the context used.
      const contextRevision = await phase("fence", () => readBriefingContextFence(caller, prepared.fenceSpec, { signal, clock }));
      if (briefingConfigurationRevision() !== configurationRevision) throw new DailyBriefError("context_changed");
      await phase("current", () => prepared.assertCurrent());
      // `iat` is the admission time, so `exp - iat` never exceeds the lease length.
      const leaseEnd = admittedAt.add({ seconds: MAX_DAILY_BRIEF_ENVELOPE_TTL_SECONDS });
      const contextEnd = Temporal.Instant.from(context.expiresAt);
      const expiresAt = Temporal.Instant.compare(contextEnd, leaseEnd) < 0 ? contextEnd : leaseEnd;
      if (Temporal.Instant.compare(expiresAt, clock()) <= 0) throw new DailyBriefError("context_expired");
      const envelope = issueDailyBriefEnvelope({
        acct: briefingAccountRef(caller.user.id), inst: installationId, lease: leaseToken, prefRev: preferences.revision,
        cfgRev: configurationRevision, ctxRev: contextRevision, fence: prepared.fenceSpec,
        iat: utc(admittedAt), exp: utc(expiresAt), validation,
      }, secret);
      if (!envelope) throw new DailyBriefError("context_limit_exceeded");
      handedOff = true;
      return { state: "prepared", request, envelope, expiresAt: utc(expiresAt) };
    } finally {
      // A failed prepare ends the attempt now; a prepared one waits for complete or the lease end.
      if (!handedOff) void finishDailyBrief(caller.client, { installationId, leaseToken, success: false, expectedRevision: preferences.revision }).catch(() => undefined);
    }
  };
  return phase("prepare_request", () => raceBriefAbort(work(), signal));
}

export async function completeDeviceDailyBrief(caller: CalendarCaller, value: unknown, options: DeviceOptions = {}): Promise<DailyBriefResponse> {
  deviceSecret();
  if (!record(value) || Object.keys(value).sort().join() !== "envelope,installationId,output") {
    throw new DailyBriefError("invalid_request");
  }
  const clock = options.now ?? (() => Temporal.Now.instant());
  const envelope = readDeviceEnvelope(caller, value, clock());
  const installationId = envelope.inst;
  const leaseToken = envelope.lease;
  const expectedRevision = envelope.prefRev;
  const output = value.output;
  const signal = AbortSignal.timeout(options.deadlineMs ?? DAILY_BRIEF_DEVICE_COMPLETE_DEADLINE_MS);
  const work = async (): Promise<DailyBriefResponse> => {
    let successful = false;
    let finished = false;
    try {
      const configurationRevision = briefingConfigurationRevision(deviceConfiguration());
      if (envelope.cfgRev !== configurationRevision || envelope.validation.configurationRevision !== configurationRevision) throw new DailyBriefError("context_changed");
      const preferences = await phase("preferences", () => readDailyBriefPreferences(caller.client, signal));
      signal.throwIfAborted();
      if (!preferences.enabled || preferences.revision !== expectedRevision) throw new DailyBriefError("context_changed");
      let tipFingerprints: readonly string[] = [];
      const briefing = await phase("validate", async () => validateDailyBrief(output, envelope.validation, {
        now: clock, onTip: (fingerprints) => { tipFingerprints = fingerprints; } }));
      // The lease must still belong to this attempt. A superseded attempt never returns text.
      finished = await phase("finish", () => finishDailyBrief(caller.client, { installationId, leaseToken, success: true, expectedRevision }, signal));
      if (!finished) throw new DailyBriefError("context_changed");
      // As the hosted path does after finishing: the stored inputs must still be the ones the context used.
      const contextRevision = await phase("fence", () => readBriefingContextFence(caller, envelope.fence, { signal, clock }));
      if (contextRevision !== envelope.ctxRev || briefingConfigurationRevision() !== configurationRevision) throw new DailyBriefError("context_changed");
      signal.throwIfAborted();
      assertBriefContextFresh(envelope.validation.context, clock());
      successful = true;
      if (tipFingerprints.length) {
        await phase("tip_record", async () => {
          for (const fingerprint of tipFingerprints) {
            await recordDailyBriefTip(caller.client, { installationId, leaseToken, expectedRevision, fingerprint }, signal);
          }
        }).catch(() => undefined);
      }
      return { state: "ready", briefing };
    } finally {
      // Only this request's own completion may be downgraded after a failed final
      // fence. A replay or invalid output can release a pending lease, never a
      // completion that another request already committed.
      if (!successful) void (finished
        ? finishDailyBrief(caller.client, { installationId, leaseToken, success: false, expectedRevision })
        : releaseDailyBrief(caller.client, { installationId, leaseToken, expectedRevision })).catch(() => undefined);
    }
  };
  return phase("complete_request", () => raceBriefAbort(work(), signal));
}

/** A failed device model call releases its pending lease before a deliberate retry. */
export async function releaseDeviceDailyBrief(caller: CalendarCaller, value: unknown, options: DeviceOptions = {}): Promise<Readonly<{ state: "released" }>> {
  deviceSecret();
  if (!record(value) || Object.keys(value).sort().join() !== "envelope,installationId") throw new DailyBriefError("invalid_request");
  const clock = options.now ?? (() => Temporal.Now.instant());
  const envelope = readDeviceEnvelope(caller, value, clock());
  const signal = AbortSignal.timeout(options.deadlineMs ?? DAILY_BRIEF_DEVICE_COMPLETE_DEADLINE_MS);
  // Configuration or preferences may have changed since prepare. Releasing only
  // the exact old pending lease remains safe and does not need a fresh context.
  const work = async () => {
    const released = await releaseDailyBrief(caller.client, {
      installationId: envelope.inst, leaseToken: envelope.lease, expectedRevision: envelope.prefRev,
    }, signal);
    if (!released) throw new DailyBriefError("context_changed");
    return { state: "released" } as const;
  };
  return phase("release_request", () => raceBriefAbort(work(), signal));
}

function readDeviceEnvelope(caller: CalendarCaller, value: Record<string, unknown>, now: Temporal.Instant) {
  if (typeof value.installationId !== "string" || !DAILY_BRIEF_INSTALLATION_ID.test(value.installationId) || typeof value.envelope !== "string") {
    throw new DailyBriefError("invalid_request");
  }
  const verified = verifyDailyBriefEnvelope(value.envelope, { secrets: readDailyBriefEnvelopeSecrets(process.env), now });
  if (!verified.ok) throw new DailyBriefError(verified.failure === "expired" ? "context_expired" : "brief_envelope_invalid");
  const envelope = verified.payload;
  if (envelope.acct !== briefingAccountRef(caller.user.id) || envelope.inst !== value.installationId) throw new DailyBriefError("brief_envelope_invalid");
  return envelope;
}

/** `Temporal.Instant` already prints UTC with `Z`; this names the intent. */
function utc(instant: Temporal.Instant): string {
  return instant.toString();
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
