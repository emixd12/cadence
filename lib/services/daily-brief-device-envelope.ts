import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Temporal } from "@js-temporal/polyfill";
import type { BriefingContextFenceSpec } from "./briefing-account-context.service";
import { DAILY_BRIEF_VALIDATION_VERSION, type DailyBriefValidationData } from "./daily-brief-consumer";

/**
 * Ticket 298 (decision D27): the signed envelope a device carries from prepare to
 * complete. The server stores no prepared payload; the envelope holds the binding and
 * the validation data, and nothing else. It is signed with a server-only HMAC-SHA256
 * secret, not encrypted: everything in it is the signed-in user's own data, which the
 * prepared request already sends to the same device. The body is compressed with raw
 * DEFLATE. The signature covers the compressed bytes and is verified before anything
 * is inflated, and inflation has an output cap.
 */
export const DAILY_BRIEF_ENVELOPE_VERSION = 1 as const;
export const DAILY_BRIEF_ENVELOPE_SECRET_ENV = "CADENCE_DAILY_BRIEF_ENVELOPE_SECRET";
export const DAILY_BRIEF_ENVELOPE_PREVIOUS_SECRET_ENV = "CADENCE_DAILY_BRIEF_ENVELOPE_SECRET_PREVIOUS";
const DOMAIN = "cadence.daily-brief-device-envelope.v1";
const MIN_SECRET_LENGTH = 32;
/** Prepared facts are capped at 512 KiB; compressed validation data stays well under this. */
export const MAX_DAILY_BRIEF_ENVELOPE_LENGTH = 1_000_000;
const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
/** Clock skew tolerated between the instance that signed and the one that verifies. */
const ISSUED_SKEW_SECONDS = 30;
/** No envelope lives longer than the attempt lease (75 seconds in `begin_daily_brief`). */
export const MAX_DAILY_BRIEF_ENVELOPE_TTL_SECONDS = 75;

export type DailyBriefEnvelopeSecrets = Readonly<{ current: string | null; previous: string | null }>;

export type DailyBriefEnvelopePayload = Readonly<{
  v: typeof DAILY_BRIEF_ENVELOPE_VERSION;
  /** `briefingAccountRef` of the signed-in user: a one-way account digest, not the user ID. */
  acct: string;
  /** The installation (host) ID the device sent to prepare. */
  inst: string;
  /** The admitted attempt's lease token. `finish_daily_brief` still checks it is current. */
  lease: string;
  /** Daily Brief preferences revision admitted with the lease. */
  prefRev: number;
  /** `briefingConfigurationRevision` the request was prepared with. */
  cfgRev: string;
  /** `readBriefingContextFence` digest of the stored inputs the context was built from. */
  ctxRev: string;
  /** What the fence reads again on complete. */
  fence: BriefingContextFenceSpec;
  iat: string;
  exp: string;
  validation: DailyBriefValidationData;
}>;

/** Ticket 298: the device-model mode is off unless this is `1` or `true`. */
export const DAILY_BRIEF_DEVICE_MODEL_ENV = "CADENCE_DAILY_BRIEF_DEVICE_MODEL";

/**
 * Whether this server offers the device-model mode: the flag is on and the envelope
 * secret is configured. It never depends on `OPENAI_API_KEY`.
 */
export function dailyBriefDeviceModelAvailable(env: Readonly<Record<string, string | undefined>>): boolean {
  const flag = env[DAILY_BRIEF_DEVICE_MODEL_ENV]?.trim().toLowerCase();
  return (flag === "1" || flag === "true") && !!readDailyBriefEnvelopeSecrets(env).current;
}

/** A secret shorter than 32 characters counts as not configured. */
export function readDailyBriefEnvelopeSecrets(env: Readonly<Record<string, string | undefined>>): DailyBriefEnvelopeSecrets {
  const value = (name: string) => {
    const secret = env[name]?.trim();
    return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
  };
  return { current: value(DAILY_BRIEF_ENVELOPE_SECRET_ENV), previous: value(DAILY_BRIEF_ENVELOPE_PREVIOUS_SECRET_ENV) };
}

/** Returns null when the envelope would exceed the size a complete request accepts. */
export function issueDailyBriefEnvelope(payload: Omit<DailyBriefEnvelopePayload, "v">, secret: string): string | null {
  const body = deflateRawSync(Buffer.from(JSON.stringify({ v: DAILY_BRIEF_ENVELOPE_VERSION, ...payload }), "utf8")).toString("base64url");
  if (body.length + 44 > MAX_DAILY_BRIEF_ENVELOPE_LENGTH) return null;
  return `${body}.${sign(body, secret)}`;
}

export type DailyBriefEnvelopeFailure = "invalid" | "expired";

/**
 * Checks shape, signature (current or previous secret, constant-time), version and
 * time window. Binding to the caller, installation, lease and revisions is the
 * service's job. Never throws; never returns the reason a signature failed.
 */
export function verifyDailyBriefEnvelope(envelope: unknown, input: Readonly<{
  secrets: DailyBriefEnvelopeSecrets;
  now: Temporal.Instant;
}>): Readonly<{ ok: true; payload: DailyBriefEnvelopePayload }> | Readonly<{ ok: false; failure: DailyBriefEnvelopeFailure }> {
  const invalid = { ok: false, failure: "invalid" } as const;
  try {
    // The previous secret only verifies during rotation; it never stands in for a missing current one.
    if (!input.secrets.current || typeof envelope !== "string" || !envelope || envelope.length > MAX_DAILY_BRIEF_ENVELOPE_LENGTH) return invalid;
    const parts = envelope.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) return invalid;
    const [body, signature] = parts as [string, string];
    const keys = [input.secrets.current, input.secrets.previous].filter((key): key is string => !!key);
    if (!keys.some((key) => sameSignature(signature, sign(body, key)))) return invalid;
    const payload: unknown = JSON.parse(inflateRawSync(Buffer.from(body, "base64url"), { maxOutputLength: MAX_INFLATED_BYTES }).toString("utf8"));
    if (!isPayload(payload)) return invalid;
    const issuedAt = Temporal.Instant.from(payload.iat), expiresAt = Temporal.Instant.from(payload.exp);
    if (Temporal.Instant.compare(issuedAt, expiresAt) >= 0 ||
        Temporal.Instant.compare(expiresAt, issuedAt.add({ seconds: MAX_DAILY_BRIEF_ENVELOPE_TTL_SECONDS })) > 0) return invalid;
    if (Temporal.Instant.compare(issuedAt, input.now.add({ seconds: ISSUED_SKEW_SECONDS })) > 0) return invalid;
    if (Temporal.Instant.compare(input.now, expiresAt) >= 0) return { ok: false, failure: "expired" };
    return { ok: true, payload };
  } catch {
    return invalid;
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

function sameSignature(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYLOAD_KEYS = "acct,cfgRev,ctxRev,exp,fence,iat,inst,lease,prefRev,v,validation";
const FENCE_KEYS = "analysis,connectorSources,localDate,travelConclusions";

/** Structure only. The signature already proves the server wrote the validation data. */
function isPayload(value: unknown): value is DailyBriefEnvelopePayload {
  if (!record(value) || Object.keys(value).sort().join() !== PAYLOAD_KEYS || value.v !== DAILY_BRIEF_ENVELOPE_VERSION) return false;
  const text = (item: unknown) => typeof item === "string" && item.length > 0 && item.length <= 200;
  if (![value.acct, value.inst, value.lease, value.cfgRev, value.ctxRev].every(text)) return false;
  if (typeof value.prefRev !== "number" || !Number.isSafeInteger(value.prefRev)) return false;
  if (typeof value.iat !== "string" || !INSTANT.test(value.iat) || typeof value.exp !== "string" || !INSTANT.test(value.exp)) return false;
  const fence = value.fence;
  if (!record(fence) || Object.keys(fence).sort().join() !== FENCE_KEYS || typeof fence.localDate !== "string" || !LOCAL_DATE.test(fence.localDate) ||
      typeof fence.travelConclusions !== "boolean") return false;
  const flags = (item: unknown, keys: string) => item === null || (record(item) && Object.keys(item).sort().join() === keys && Object.values(item).every((flag) => typeof flag === "boolean"));
  if (!flags(fence.connectorSources, "calendars,recordedActivity") || !flags(fence.analysis, "includeNotes,includeReminders")) return false;
  return record(value.validation) && value.validation.version === DAILY_BRIEF_VALIDATION_VERSION;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
