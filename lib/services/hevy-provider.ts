import { Temporal } from "@js-temporal/polyfill";
import {
  normalizeRecordedWorkout,
  validateRecordedActivitySnapshot,
} from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventErrorCode } from "@cadence/core/types/external-event";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  RECORDED_ACTIVITY_MAX_ITEMS,
  RECORDED_ACTIVITY_MAX_PAGES,
  RECORDED_ACTIVITY_PAGE_SIZE,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  RECORDED_ACTIVITY_SOURCE,
  type RecordedActivity,
  type RecordedActivityCoverage,
  type RecordedActivityFailure,
  type RecordedActivityRequestedRange,
  type RecordedActivitySnapshotV1,
  type RecordedWorkoutTimingInput,
} from "@cadence/core/types/recorded-activity";
import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "./provider-call-timeout";

// Ticket 236 Hevy adapter. It performs exactly three read-only calls and keeps
// only workout identity and timing. Titles, descriptions, routines, exercises,
// sets, weights, reps, and notes are dropped per item before anything else sees
// them. See docs/INTEGRATION_PLAYBOOK.md "Hevy workout timing (Ticket 236)" and
// docs/EXTERNAL_EVENT_CONTRACT.md "Recorded activity snapshot (Hevy)".

export const HEVY_API_ORIGIN = "https://api.hevyapp.com";
/** One absolute deadline spans the count preflight, every page, every retry, and the final count. */
export const HEVY_READ_DEADLINE_MS = 25_000;
export const HEVY_ATTEMPT_TIMEOUT_MS = 10_000;
export const HEVY_MAX_RETRIES = 2;
/** A page of 10 full workouts includes exercise data before it is discarded. */
export const HEVY_RESPONSE_MAX_BYTES = 2_000_000;
const MAX_BACKOFF_MS = 5_000;

export type HevyFetch = (input: string, init: RequestInit) => Promise<Response>;

export type HevyCall =
  | Readonly<{ kind: "user_info" }>
  | Readonly<{ kind: "workout_count" }>
  | Readonly<{ kind: "workouts"; page: number }>;

export type HevyRequestOptions = Readonly<{
  fetch?: HevyFetch;
  /** Milliseconds since epoch. Injected so deadlines are testable. */
  clock?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Caller cancellation, for example the Daily Brief budget. */
  signal?: AbortSignal;
  /** At most 25 seconds. Daily Brief passes a smaller remaining budget. */
  deadlineMs?: number;
}>;

export type HevyReadInput = HevyRequestOptions & Readonly<{
  apiKey: string;
  accountId: string;
  connectionGeneration: number;
  range: RecordedActivityRequestedRange;
}>;

export class HevyProviderError extends Error {
  constructor(public readonly failure: RecordedActivityFailure) {
    super(failure.code);
    this.name = "HevyProviderError";
  }
}

const API_KEY = /^[A-Za-z0-9._~-]{1,256}$/;

/**
 * Builds the only URLs Cadence may send a Hevy key to. Every other method,
 * origin, path, or page is refused before a credential is attached.
 */
export function hevyRequestUrl(call: HevyCall): string {
  if (call.kind === "user_info") return `${HEVY_API_ORIGIN}/v1/user/info`;
  if (call.kind === "workout_count") return `${HEVY_API_ORIGIN}/v1/workouts/count`;
  if (!Number.isSafeInteger(call.page) || call.page < 1 || call.page > RECORDED_ACTIVITY_MAX_PAGES) {
    throw new RangeError("Hevy page is outside the allowed bound.");
  }
  return `${HEVY_API_ORIGIN}/v1/workouts?page=${call.page}&pageSize=${RECORDED_ACTIVITY_PAGE_SIZE}`;
}

/** Fixed allowlist check applied immediately before the key header is attached. */
export function isAllowedHevyRequest(method: string, url: string): boolean {
  if (method !== "GET") return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.origin !== HEVY_API_ORIGIN || parsed.username || parsed.password || parsed.hash) return false;
  if (parsed.pathname === "/v1/user/info" || parsed.pathname === "/v1/workouts/count") return parsed.search === "";
  if (parsed.pathname !== "/v1/workouts") return false;
  const keys = [...parsed.searchParams.keys()];
  const page = parsed.searchParams.get("page") ?? "";
  return keys.length === 2 && keys[0] === "page" && keys[1] === "pageSize"
    && /^[1-9]\d{0,1}$/.test(page) && Number(page) <= RECORDED_ACTIVITY_MAX_PAGES
    && parsed.searchParams.get("pageSize") === String(RECORDED_ACTIVITY_PAGE_SIZE);
}

/**
 * Connect-time identity read. Returns only the Hevy user ID for the account
 * digest. Username, name, profile URL, and units are discarded. A key Hevy
 * rejects is `reconnect_required`; a non-Pro account is `permission_denied`.
 */
export async function verifyHevyApiKey(apiKey: string, options: HevyRequestOptions = {}): Promise<readonly [string]> {
  const session = new HevySession(apiKey, options);
  try {
    const body = record(await session.get({ kind: "user_info" }));
    const data = record(body?.data);
    const id = data?.id;
    if (typeof id !== "string" || id.length === 0 || id.length > 512 || typeof data?.is_pro !== "boolean") {
      throw new HevyProviderError(failure("malformed_provider_response", false, null));
    }
    if (!data.is_pro) throw new HevyProviderError(failure("permission_denied", false, null));
    return [id];
  } finally {
    session.close();
  }
}

/**
 * Reads every workout page once under one absolute deadline and returns a
 * validated recorded-activity snapshot. The snapshot is `complete` only when the
 * pre-read count fits the 500-workout ceiling, every page was read, page_count
 * and count are unchanged after the read, and every item was usable. Ordering is
 * undocumented, so the read never stops early. `complete` means no change was
 * detected; it is not an atomic snapshot.
 */
export async function readHevyWorkouts(input: HevyReadInput): Promise<RecordedActivitySnapshotV1> {
  if (!input.accountId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1) {
    throw new RangeError("Hevy read requires an account and connection generation.");
  }
  const session = new HevySession(input.apiKey, input);
  const fetchedAt = Temporal.Instant.fromEpochMilliseconds(session.startedAt);
  const fetchedAtText = fetchedAt.toString();
  const state = new ReadState();
  try {
    state.countBefore = parseCount(await session.get({ kind: "workout_count" }));
    if (state.countBefore > RECORDED_ACTIVITY_MAX_ITEMS) {
      state.fail(failure("incomplete_pagination", false, null));
    } else {
      await readPages(session, state);
      if (!state.failed()) {
        state.countAfter = parseCount(await session.get({ kind: "workout_count" }));
      }
    }
  } catch (error) {
    state.fail(error instanceof HevyProviderError ? error.failure : failure("provider_unavailable", true, null));
  } finally {
    session.close();
  }
  return buildSnapshot(input, fetchedAtText, state, Temporal.Instant.fromEpochMilliseconds(Math.max(session.now(), session.startedAt)));
}

class ReadState {
  countBefore: number | null = null;
  countAfter: number | null = null;
  pageCount: number | null = null;
  pagesRead = 0;
  paginationComplete = false;
  itemCount = 0;
  duplicatesRemoved = 0;
  quarantined = 0;
  readonly timing = new Map<string, RecordedWorkoutTimingInput>();
  private failure: RecordedActivityFailure | null = null;
  fail(value: RecordedActivityFailure) { this.failure ??= value; }
  failed(): boolean { return this.failure !== null; }
  failures(): RecordedActivityFailure[] { return this.failure ? [this.failure] : []; }
}

async function readPages(session: HevySession, state: ReadState): Promise<void> {
  for (let page = 1; page <= RECORDED_ACTIVITY_MAX_PAGES; page += 1) {
    const body = record(await session.get({ kind: "workouts", page }));
    const pageCount = body?.page_count;
    if (!body || !Number.isSafeInteger(pageCount) || (pageCount as number) < 0 || body.page !== page || !Array.isArray(body.workouts)
      || body.workouts.length > RECORDED_ACTIVITY_PAGE_SIZE) {
      throw new HevyProviderError(failure("malformed_provider_response", false, null));
    }
    if (state.pageCount === null) {
      state.pageCount = pageCount as number;
      if (state.pageCount > RECORDED_ACTIVITY_MAX_PAGES) {
        throw new HevyProviderError(failure("incomplete_pagination", false, null));
      }
    } else if (pageCount !== state.pageCount) {
      // The page set moved during the read; earlier offsets can no longer be trusted.
      throw new HevyProviderError(failure("incomplete_pagination", true, null));
    }
    if (state.pageCount === 0) {
      if (body.workouts.length > 0) throw new HevyProviderError(failure("malformed_provider_response", false, null));
      state.paginationComplete = true;
      return;
    }
    state.pagesRead = page;
    for (const item of body.workouts) acceptItem(state, item);
    if (page >= state.pageCount) {
      state.paginationComplete = true;
      return;
    }
  }
}

/** Discards everything except identity and timing at the adapter boundary. */
function acceptItem(state: ReadState, item: unknown): void {
  state.itemCount += 1;
  const workout = record(item);
  const timing: RecordedWorkoutTimingInput = {
    providerWorkoutId: typeof workout?.id === "string" ? workout.id : null,
    startTime: scalar(workout?.start_time),
    endTime: scalar(workout?.end_time),
    updatedAt: scalar(workout?.updated_at),
  };
  const id = timing.providerWorkoutId;
  if (typeof id !== "string" || id.length === 0 || id.length > 512) {
    state.quarantined += 1;
    return;
  }
  const previous = state.timing.get(id);
  if (previous) {
    state.itemCount -= 1;
    state.duplicatesRemoved += 1;
    if (compareUpdated(timing.updatedAt, previous.updatedAt) > 0) state.timing.set(id, timing);
    return;
  }
  state.timing.set(id, timing);
}

/** Keeps strings and absence only, so no nested provider object survives the item. */
function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : MALFORMED;
}
const MALFORMED = "malformed";

function compareUpdated(left: unknown, right: unknown): number {
  const a = instantOrNull(left); const b = instantOrNull(right);
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return Temporal.Instant.compare(a, b);
}

function buildSnapshot(input: HevyReadInput, fetchedAt: string, state: ReadState, now: Temporal.Instant): RecordedActivitySnapshotV1 {
  const activities: RecordedActivity[] = [];
  for (const timing of state.timing.values()) {
    const result = normalizeRecordedWorkout(timing, { accountId: input.accountId, requestedRange: input.range, fetchedAt });
    if (result.status === "accepted") activities.push(result.activity);
    else if (result.status === "quarantined") state.quarantined += 1;
  }
  activities.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id));
  if (!state.failed()) {
    if (state.quarantined > 0) state.fail(failure("malformed_provider_response", false, null));
    else if (!state.paginationComplete || state.countBefore === null || state.countAfter !== state.countBefore
      || state.itemCount !== state.countBefore) state.fail(failure("incomplete_pagination", true, null));
  }
  const coverage: RecordedActivityCoverage = {
    pagesRead: state.pagesRead,
    pageCount: state.pageCount,
    countBefore: state.countBefore,
    countAfter: state.countAfter,
    itemCount: state.itemCount,
    duplicatesRemoved: state.duplicatesRemoved,
    paginationComplete: state.paginationComplete,
  };
  const failures = state.failures();
  const snapshot: RecordedActivitySnapshotV1 = {
    schemaVersion: RECORDED_ACTIVITY_SCHEMA_VERSION,
    adapterVersion: HEVY_WORKOUTS_ADAPTER_VERSION,
    source: RECORDED_ACTIVITY_SOURCE,
    accountId: input.accountId,
    connectionGeneration: input.connectionGeneration,
    requestedRange: { startLocalDate: input.range.startLocalDate, endLocalDate: input.range.endLocalDate, timezone: input.range.timezone },
    fetchedAt,
    completeness: failures.length === 0 ? "complete" : "incomplete",
    coverage,
    failures,
    activities,
  };
  return validateRecordedActivitySnapshot(snapshot, { now });
}

/** One read session: one key, one absolute deadline, bounded retries per call. */
class HevySession {
  readonly startedAt: number;
  private readonly deadline: number;
  private readonly controller = new AbortController();
  private readonly fetcher: HevyFetch;
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly detach: () => void;

  constructor(private readonly apiKey: string, options: HevyRequestOptions) {
    if (!API_KEY.test(apiKey)) throw new HevyProviderError(failure("invalid_request", false, null));
    this.fetcher = options.fetch ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
    const budget = options.deadlineMs ?? HEVY_READ_DEADLINE_MS;
    if (!Number.isFinite(budget) || budget <= 0 || budget > HEVY_READ_DEADLINE_MS) {
      throw new RangeError(`Hevy deadline must be within ${HEVY_READ_DEADLINE_MS} ms.`);
    }
    this.startedAt = this.clock();
    this.deadline = this.startedAt + budget;
    this.timer = setTimeout(() => this.controller.abort(), budget);
    const external = options.signal;
    const onAbort = () => this.controller.abort();
    if (external?.aborted) this.controller.abort();
    external?.addEventListener("abort", onAbort, { once: true });
    this.detach = () => external?.removeEventListener("abort", onAbort);
  }

  now(): number { return this.clock(); }
  close(): void { clearTimeout(this.timer); this.detach(); }
  private remaining(): number { return this.deadline - this.clock(); }
  private expired(): boolean { return this.controller.signal.aborted || this.remaining() <= 0; }

  async get(call: HevyCall): Promise<unknown> {
    const url = hevyRequestUrl(call);
    if (!isAllowedHevyRequest("GET", url)) throw new HevyProviderError(failure("invalid_request", false, null));
    for (let attempt = 0; attempt <= HEVY_MAX_RETRIES; attempt += 1) {
      if (this.expired()) throw new HevyProviderError(failure("timeout", true, null));
      const timeoutMs = Math.max(1, Math.min(HEVY_ATTEMPT_TIMEOUT_MS, this.remaining()));
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeoutMs)]);
      let outcome: { body: unknown } | { failure: RecordedActivityFailure; retryAfter: number | null };
      try {
        outcome = await runProviderCallWithTimeout(async (callSignal) => {
          const response = await this.fetcher(url, { method: "GET", headers: { "api-key": this.apiKey, accept: "application/json" },
            redirect: "error", cache: "no-store", signal: callSignal });
          if (response.ok) return { body: await readJson(response, callSignal) };
          void response.body?.cancel().catch(() => undefined);
          const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
          return { failure: httpFailure(response.status, call, retryAfter), retryAfter };
        }, { timeoutMs, signal });
      } catch (error) {
        if (error instanceof HevyProviderError) throw error;
        if (this.expired()) throw new HevyProviderError(failure("timeout", true, null));
        const timedOut = error instanceof ProviderCallTimeoutError;
        outcome = { failure: failure(timedOut ? "timeout" : "provider_unavailable", true, null), retryAfter: null };
      }
      // A response that lands after the absolute deadline is discarded.
      if (this.expired()) throw new HevyProviderError(failure("timeout", true, null));
      if ("body" in outcome) return outcome.body;
      if (!outcome.failure.retryable || attempt === HEVY_MAX_RETRIES) throw new HevyProviderError(outcome.failure);
      const delay = outcome.retryAfter !== null
        ? outcome.retryAfter * 1_000
        : Math.min(MAX_BACKOFF_MS, 250 * 2 ** attempt + Math.floor(this.random() * 250));
      // Retry-After is honored only when the wait plus one second still fits.
      if (outcome.retryAfter !== null && delay + 1_000 > this.remaining()) throw new HevyProviderError(outcome.failure);
      if (delay >= this.remaining()) throw new HevyProviderError(failure("timeout", true, null));
      try { await this.sleep(delay, this.controller.signal); }
      catch { throw new HevyProviderError(failure("timeout", true, null)); }
    }
    throw new HevyProviderError(failure("provider_unavailable", true, null));
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > HEVY_RESPONSE_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new HevyProviderError(failure("malformed_provider_response", false, null));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HevyProviderError(failure("malformed_provider_response", false, null));
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel().catch(() => undefined); throw signal.reason; }
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > HEVY_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HevyProviderError(failure("malformed_provider_response", false, null));
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new HevyProviderError(failure("malformed_provider_response", false, null));
  }
}

function parseCount(body: unknown): number {
  const count = record(body)?.workout_count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new HevyProviderError(failure("malformed_provider_response", false, null));
  }
  return count as number;
}

function httpFailure(status: number, call: HevyCall, retryAfter: number | null): RecordedActivityFailure {
  if (status === 401 || status === 403) return failure("reconnect_required", false, null);
  if (status === 404 && call.kind === "user_info") return failure("reconnect_required", false, null);
  if (status === 429) return failure("rate_limited", true, retryAfter);
  if (status >= 500) return failure("provider_unavailable", true, retryAfter);
  if (status === 400) return failure("invalid_request", false, null);
  return failure("provider_unavailable", false, null);
}

const MESSAGES: Readonly<Partial<Record<ExternalEventErrorCode, string>>> = {
  reconnect_required: "Hevy did not accept the API key.",
  permission_denied: "Hevy's API requires an active Hevy Pro subscription.",
  rate_limited: "Hevy rate limited the read.",
  provider_unavailable: "Hevy is unavailable.",
  timeout: "The Hevy read did not finish before its deadline.",
  malformed_provider_response: "Hevy returned data Cadence could not use.",
  incomplete_pagination: "Cadence could not confirm every Hevy workout was read.",
  invalid_request: "Hevy rejected the bounded read.",
};

function failure(code: ExternalEventErrorCode, retryable: boolean, retryAfter: number | null): RecordedActivityFailure {
  return { code, retryable, retryAfterSeconds: retryAfter, message: MESSAGES[code] ?? "Hevy read failed." };
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  return Number(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function instantOrNull(value: unknown): Temporal.Instant | null {
  if (typeof value !== "string" || value.length > 64) return null;
  try { return Temporal.Instant.from(value); } catch { return null; }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timeout = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    function onAbort() { clearTimeout(timeout); reject(signal.reason); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
