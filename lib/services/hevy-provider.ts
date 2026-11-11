import { Temporal } from "@js-temporal/polyfill";
import {
  normalizeRecordedWorkout,
  recordedActivityId,
  recordedActivitySelectorKey,
  validateRecordedActivitySnapshot,
  validateRecordedActivitySnapshotV1_1,
  withSelectorKeys,
} from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventErrorCode } from "@cadence/core/types/external-event";
import {
  HEVY_WORKOUTS_ADAPTER_VERSION,
  HEVY_WORKOUTS_MATCH_ADAPTER_VERSION,
  RECORDED_ACTIVITY_MAX_ITEMS,
  RECORDED_ACTIVITY_MAX_PAGES,
  RECORDED_ACTIVITY_PAGE_SIZE,
  RECORDED_ACTIVITY_SCHEMA_VERSION,
  RECORDED_ACTIVITY_SCHEMA_VERSION_1_1,
  RECORDED_ACTIVITY_SOURCE,
  type RecordedActivity,
  type RecordedActivityCoverage,
  type RecordedActivityFailure,
  type RecordedActivityRequestedRange,
  type RecordedActivitySnapshotV1,
  type RecordedActivitySnapshotV1_1,
  type RecordedActivityV1_1,
  type RecordedWorkoutTimingInput,
} from "@cadence/core/types/recorded-activity";
import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "./provider-call-timeout";

// Ticket 236 Hevy adapter. It performs only fixed read-only calls and keeps
// only workout identity and timing. Titles, descriptions, routines, exercises,
// sets, weights, reps, and notes are dropped per item before anything else sees
// them. Ticket 315 adds two reads for connector completion: a match read that also
// keeps each workout's `routine_id` as an account-scoped digest (contract 1.1), and
// a routine list for the link form whose titles are returned and never stored. See docs/INTEGRATION_PLAYBOOK.md "Hevy workout timing (Ticket 236)" and
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
  | Readonly<{ kind: "workouts"; page: number }>
  | Readonly<{ kind: "routines"; page: number }>
  | Readonly<{ kind: "workout_events"; page: number; since: string }>;

/** Hevy returns routines 10 per page; the link form reads at most 20 pages (200 routines). */
export const HEVY_ROUTINE_PAGE_SIZE = 10;
export const HEVY_ROUTINE_MAX_PAGES = 20;
/**
 * Ticket 311 chose strategy A: `/v1/workouts/events?since=` keys on `updated_at`,
 * inclusively, newest first. One change read takes at most 20 pages (200 events);
 * past that the caller falls back to the full read.
 */
export const HEVY_EVENT_PAGE_SIZE = 10;
export const HEVY_EVENT_MAX_PAGES = 20;
const HEVY_SINCE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

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
  if (call.kind === "workout_events") {
    if (!Number.isSafeInteger(call.page) || call.page < 1 || call.page > HEVY_EVENT_MAX_PAGES || !HEVY_SINCE.test(call.since)) {
      throw new RangeError("Hevy event page or since is outside the allowed bound.");
    }
    return `${HEVY_API_ORIGIN}/v1/workouts/events?page=${call.page}&pageSize=${HEVY_EVENT_PAGE_SIZE}&since=${encodeURIComponent(call.since)}`;
  }
  if (call.kind === "routines") {
    if (!Number.isSafeInteger(call.page) || call.page < 1 || call.page > HEVY_ROUTINE_MAX_PAGES) {
      throw new RangeError("Hevy routine page is outside the allowed bound.");
    }
    return `${HEVY_API_ORIGIN}/v1/routines?page=${call.page}&pageSize=${HEVY_ROUTINE_PAGE_SIZE}`;
  }
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
  if (parsed.pathname === "/v1/workouts/events") {
    const eventKeys = [...parsed.searchParams.keys()];
    const eventPage = parsed.searchParams.get("page") ?? "";
    return eventKeys.length === 3 && eventKeys[0] === "page" && eventKeys[1] === "pageSize" && eventKeys[2] === "since"
      && /^[1-9]\d{0,1}$/.test(eventPage) && Number(eventPage) <= HEVY_EVENT_MAX_PAGES
      && parsed.searchParams.get("pageSize") === String(HEVY_EVENT_PAGE_SIZE)
      && HEVY_SINCE.test(parsed.searchParams.get("since") ?? "");
  }
  const bounds = parsed.pathname === "/v1/workouts"
    ? { maxPages: RECORDED_ACTIVITY_MAX_PAGES, pageSize: RECORDED_ACTIVITY_PAGE_SIZE }
    : parsed.pathname === "/v1/routines"
      ? { maxPages: HEVY_ROUTINE_MAX_PAGES, pageSize: HEVY_ROUTINE_PAGE_SIZE }
      : null;
  if (!bounds) return false;
  const keys = [...parsed.searchParams.keys()];
  const page = parsed.searchParams.get("page") ?? "";
  return keys.length === 2 && keys[0] === "page" && keys[1] === "pageSize"
    && /^[1-9]\d{0,1}$/.test(page) && Number(page) <= bounds.maxPages
    && parsed.searchParams.get("pageSize") === String(bounds.pageSize);
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
  const { state, fetchedAtText, now } = await readWorkoutPages(input, false);
  return buildSnapshot(input, fetchedAtText, state, now);
}

export type HevyMatchReadInput = HevyReadInput & Readonly<{
  /** The connection's account digest; selector keys are scoped to it. */
  accountDigest: string;
}>;

/**
 * The connector-completion match read (Ticket 315). Same pages, bounds and
 * completeness rules as the display read, plus each workout's `routine_id` as an
 * account-scoped selector digest. Returns contract `1.1.0`. The raw routine ID
 * never leaves this function.
 */
export async function readHevyMatchEvidence(input: HevyMatchReadInput): Promise<RecordedActivitySnapshotV1_1> {
  if (!/^[a-f0-9]{64}$/u.test(input.accountDigest)) throw new RangeError("Hevy match read requires the account digest.");
  const { state, fetchedAtText, now } = await readWorkoutPages(input, true);
  const display = buildSnapshot(input, fetchedAtText, state, now);
  const activities: RecordedActivityV1_1[] = display.activities.map((activity) => {
    const providerKey = state.routineByActivity.get(activity.id) ?? null;
    return withSelectorKeys(activity, providerKey === null ? [] : [recordedActivitySelectorKey({
      source: RECORDED_ACTIVITY_SOURCE, accountDigest: input.accountDigest, providerKey,
    })]);
  });
  return validateRecordedActivitySnapshotV1_1({
    ...display,
    schemaVersion: RECORDED_ACTIVITY_SCHEMA_VERSION_1_1,
    adapterVersion: HEVY_WORKOUTS_MATCH_ADAPTER_VERSION,
    selectorKeysRequested: true,
    activities,
  }, { now });
}

export type HevyRoutineOption = Readonly<{ selectorKey: string; title: string }>;
export type HevyRoutineList = Readonly<{
  routines: readonly HevyRoutineOption[];
  /** False when Hevy has more than 20 pages; the first 200 are returned. */
  complete: boolean;
}>;

/**
 * Routine titles for the link form. Titles are returned to the caller only and are
 * never stored or logged; each routine's identity leaves as its selector digest.
 */
export async function listHevyRoutines(
  input: HevyRequestOptions & Readonly<{ apiKey: string; accountDigest: string }>,
): Promise<HevyRoutineList> {
  if (!/^[a-f0-9]{64}$/u.test(input.accountDigest)) throw new RangeError("Hevy routine list requires the account digest.");
  const session = new HevySession(input.apiKey, input);
  const routines = new Map<string, string>();
  try {
    for (let page = 1; page <= HEVY_ROUTINE_MAX_PAGES; page += 1) {
      const body = record(await session.get({ kind: "routines", page }));
      const pageCount = body?.page_count;
      if (!body || !Number.isSafeInteger(pageCount) || (pageCount as number) < 0 || !Array.isArray(body.routines)
        || body.routines.length > HEVY_ROUTINE_PAGE_SIZE) {
        throw new HevyProviderError(failure("malformed_provider_response", false, null));
      }
      for (const item of body.routines) {
        const routine = record(item);
        const id = routine?.id, title = routine?.title;
        if (typeof id !== "string" || id.length === 0 || id.length > 512) continue;
        const selectorKey = recordedActivitySelectorKey({ source: RECORDED_ACTIVITY_SOURCE, accountDigest: input.accountDigest, providerKey: id });
        routines.set(selectorKey, typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : "Untitled routine");
      }
      if (page >= (pageCount as number)) {
        return { routines: [...routines].map(([selectorKey, title]) => ({ selectorKey, title })), complete: true };
      }
    }
    return { routines: [...routines].map(([selectorKey, title]) => ({ selectorKey, title })), complete: false };
  } finally {
    session.close();
  }
}

export type HevyMatchChanges = Readonly<{
  /** Updated workouts inside the range, as contract 1.1 activities with selector keys. */
  activities: readonly RecordedActivityV1_1[];
  /** Activity IDs (`hevy/<digest>`) of workouts Hevy reports deleted. */
  deletedActivityRefs: readonly string[];
  /** The newest `updated_at` or `deleted_at` seen, or null when no event arrived. */
  newestChangeAt: string | null;
  /** False when the events ran past 20 pages; the caller then reads in full. */
  complete: boolean;
  /** When the read started, on Cadence's clock. */
  fetchedAt: string;
}>;

/**
 * Ticket 311 strategy A: the workouts changed since a cursor. New, back-dated and
 * edited workouts arrive as `updated` events and deletions as `deleted` events, so a
 * quiet account costs one page whatever its history. Keeps only identity, timing and
 * the routine digest, like the full match read.
 */
export async function readHevyMatchChanges(input: HevyMatchReadInput & Readonly<{ since: string }>): Promise<HevyMatchChanges> {
  if (!/^[a-f0-9]{64}$/u.test(input.accountDigest)) throw new RangeError("Hevy match read requires the account digest.");
  if (!HEVY_SINCE.test(input.since)) throw new RangeError("Hevy change read requires a UTC since instant.");
  const session = new HevySession(input.apiKey, input);
  const fetchedAt = Temporal.Instant.fromEpochMilliseconds(session.startedAt).toString();
  const activities = new Map<string, RecordedActivityV1_1>();
  const deleted = new Set<string>();
  let newest: Temporal.Instant | null = null;
  const note = (value: unknown) => {
    const at = instantOrNull(value);
    if (at && (!newest || Temporal.Instant.compare(at, newest) > 0)) newest = at;
  };
  try {
    for (let page = 1; page <= HEVY_EVENT_MAX_PAGES; page += 1) {
      const body = record(await session.get({ kind: "workout_events", page, since: input.since }));
      const pageCount = body?.page_count;
      if (!body || !Number.isSafeInteger(pageCount) || (pageCount as number) < 0 || !Array.isArray(body.events)
        || body.events.length > HEVY_EVENT_PAGE_SIZE) {
        throw new HevyProviderError(failure("malformed_provider_response", false, null));
      }
      if ((pageCount as number) > HEVY_EVENT_MAX_PAGES) {
        return { activities: [], deletedActivityRefs: [], newestChangeAt: null, complete: false, fetchedAt };
      }
      for (const item of body.events) acceptEvent(item);
      if (page >= (pageCount as number)) break;
    }
  } finally {
    session.close();
  }
  return {
    activities: [...activities.values()].sort((left, right) => left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id)),
    deletedActivityRefs: [...deleted].sort(),
    newestChangeAt: newest === null ? null : (newest as Temporal.Instant).toString(),
    complete: true,
    fetchedAt,
  };

  function acceptEvent(item: unknown): void {
    const event = record(item);
    if (event?.type === "deleted") {
      if (typeof event.id !== "string" || event.id.length === 0 || event.id.length > 512) {
        throw new HevyProviderError(failure("malformed_provider_response", false, null));
      }
      const id = recordedActivityId({ accountId: input.accountId, providerWorkoutId: event.id });
      deleted.add(id);
      activities.delete(id);
      note(event.deleted_at);
      return;
    }
    const workout = record(event?.workout);
    if (event?.type !== "updated" || !workout) throw new HevyProviderError(failure("malformed_provider_response", false, null));
    note(workout.updated_at);
    const result = normalizeRecordedWorkout({
      providerWorkoutId: typeof workout.id === "string" ? workout.id : null,
      startTime: scalar(workout.start_time),
      endTime: scalar(workout.end_time),
      updatedAt: scalar(workout.updated_at),
    }, { accountId: input.accountId, requestedRange: input.range, fetchedAt });
    if (result.status !== "accepted" || deleted.has(result.activity.id)) return;
    const routineId = typeof workout.routine_id === "string" && workout.routine_id.length > 0 && workout.routine_id.length <= 512
      ? workout.routine_id : null;
    // Events arrive newest first, so the first sighting of a workout is its latest state.
    if (activities.has(result.activity.id)) return;
    activities.set(result.activity.id, withSelectorKeys(result.activity, routineId === null ? [] : [recordedActivitySelectorKey({
      source: RECORDED_ACTIVITY_SOURCE, accountDigest: input.accountDigest, providerKey: routineId,
    })]));
  }
}

async function readWorkoutPages(input: HevyReadInput, keepRoutines: boolean): Promise<Readonly<{
  state: ReadState;
  fetchedAtText: string;
  now: Temporal.Instant;
}>> {
  if (!input.accountId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1) {
    throw new RangeError("Hevy read requires an account and connection generation.");
  }
  const session = new HevySession(input.apiKey, input);
  const fetchedAt = Temporal.Instant.fromEpochMilliseconds(session.startedAt);
  const fetchedAtText = fetchedAt.toString();
  const state = new ReadState(keepRoutines ? input.accountId : null);
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
  return { state, fetchedAtText, now: Temporal.Instant.fromEpochMilliseconds(Math.max(session.now(), session.startedAt)) };
}

class ReadState {
  /** Set only for a match read: the Cadence account that scopes activity IDs. */
  constructor(readonly routineAccountId: string | null = null) {}
  /** Activity ID → raw routine ID, for a match read only. Never leaves the adapter. */
  readonly routineByActivity = new Map<string, string | null>();
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
  const routineId = state.routineAccountId !== null && typeof workout?.routine_id === "string"
    && workout.routine_id.length > 0 && workout.routine_id.length <= 512 ? workout.routine_id : null;
  const previous = state.timing.get(id);
  if (previous) {
    state.itemCount -= 1;
    state.duplicatesRemoved += 1;
    if (compareUpdated(timing.updatedAt, previous.updatedAt) > 0) {
      state.timing.set(id, timing);
      rememberRoutine(state, id, routineId);
    }
    return;
  }
  state.timing.set(id, timing);
  rememberRoutine(state, id, routineId);
}

function rememberRoutine(state: ReadState, providerWorkoutId: string, routineId: string | null): void {
  if (state.routineAccountId === null) return;
  state.routineByActivity.set(
    recordedActivityId({ accountId: state.routineAccountId, providerWorkoutId }),
    routineId,
  );
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
