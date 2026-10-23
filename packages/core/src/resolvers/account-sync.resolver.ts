import { sha256 } from "../hash";
import { parseArchiveNotes } from "./archive-note.resolver";
import { NOTE_SHORTCUT_LIMITS, validateNoteShortcutState } from "./note-suggestion.resolver";
import { travelHabitSyncJson, travelHabitsFromSyncValue } from "../services/travel-habits";
import { Temporal } from "@js-temporal/polyfill";
import type { Json } from "../types/json";

export const ACCOUNT_SYNC_ENTITY_KINDS = ["profile", "category", "behavior", "schedule", "schedule_slot", "definition_event", "configuration_event", "occurrence", "status_event", "time_session", "import_run", "mapping", "imported_note", "imported_intervention", "reminder_delivery", "note_shortcut_state"] as const;
export const ACCOUNT_SYNC_ROW_LIMIT = 100_000;
export const ACCOUNT_SYNC_BYTE_LIMIT = 64 * 1024 * 1024;
export const ACCOUNT_SYNC_TIME_LIMIT_MS = 30_000;
export type AccountSyncEntityKind = (typeof ACCOUNT_SYNC_ENTITY_KINDS)[number];
export type AccountSyncEntity = Readonly<{ kind: AccountSyncEntityKind; id: string; value: Json }>;
export type AccountSyncSnapshot = Readonly<{ fingerprint?: string; entities: readonly AccountSyncEntity[] }>;
export type AccountSyncWrite = Readonly<{ kind: AccountSyncEntityKind; id: string; operation: "upsert" | "delete"; expected: Json | null; value?: Json }>;
export type AccountSyncConflict = Readonly<{ kind: AccountSyncEntityKind; id: string; reason: "concurrent_update" | "delete_vs_update" | "append_id_collision" | "history_rewrite" | "history_branch"; baseline: Json | null; local: Json | null; hosted: Json | null }>;
export type AccountSyncConflictChoice = "hosted" | "local" | "both";
export type AccountSyncConflictDecision = Readonly<{ kind: AccountSyncEntityKind; id: string; choice: AccountSyncConflictChoice; duplicateId?: string }>;
export type AccountSyncPlan = Readonly<{ localWrites: readonly AccountSyncWrite[]; hostedWrites: readonly AccountSyncWrite[]; conflicts: readonly AccountSyncConflict[]; mergedEntities: readonly AccountSyncEntity[]; fingerprints: Readonly<{ baseline: string; local: string; hosted: string; merged: string | null }>; idempotencyKey: string | null }>;
export type NoteShortcutExclusionPolicy = "preserve" | "discard_local";

const HISTORY = new Set<AccountSyncEntityKind>(["definition_event", "configuration_event", "status_event", "mapping"]);
const PROTECTED_DELETE = new Set<AccountSyncEntityKind>(["behavior", "import_run", "imported_note", "imported_intervention", "reminder_delivery", "time_session"]);
// Sync strips source ownership; this placeholder only enables shared state validation.
const SYNC_NOTE_SHORTCUT_OWNER_ID = "00000000-0000-4000-8000-000000000000";

export function accountSyncFingerprint(snapshot: AccountSyncSnapshot): string { return fingerprint(prepare(snapshot).values()); }

export function resolveFirstLinkReplacement(input: Readonly<{ accountLinkId: string; baseline: AccountSyncSnapshot; local: AccountSyncSnapshot; hosted: AccountSyncSnapshot }>): AccountSyncPlan {
  const baseline = prepare(input.baseline), local = prepare(input.local), hosted = prepare(input.hosted);
  validateInputGraphs(true, baseline, local, hosted);
  const fingerprints = { baseline: fingerprint(baseline.values()), local: fingerprint(local.values()), hosted: fingerprint(hosted.values()) };
  const mergedEntities = [...hosted.values()].sort(compareEntity), merged = fingerprint(mergedEntities);
  return { localWrites: writesBetween(local, hosted), hostedWrites: [], conflicts: [], mergedEntities,
    fingerprints: { ...fingerprints, merged }, idempotencyKey: sha256(`${input.accountLinkId}:${fingerprints.baseline}:${fingerprints.local}:${fingerprints.hosted}:${merged}:first-link-replacement`) };
}

export function resolveAccountSync(input: Readonly<{ accountLinkId?: string; baseline: AccountSyncSnapshot; local: AccountSyncSnapshot; hosted: AccountSyncSnapshot; firstLink?: boolean; firstHostedHydration?: boolean; noteShortcutExclusionPolicy?: NoteShortcutExclusionPolicy }>): AccountSyncPlan {
  const accountLinkId = input.accountLinkId ?? "account-link";
  const baseline = prepare(input.baseline), local = prepare(input.local), hosted = prepare(input.hosted);
  validateInputGraphs(input.firstLink === true, baseline, local, hosted);
  const compatibleMarks = compatibleInitialMarks(baseline, local, hosted);
  const baselineProtectedOccurrences = protectedOccurrenceIds(baseline);
  const protectedOccurrences = protectedOccurrenceIds(baseline, local, hosted);
  const fingerprints = { baseline: fingerprint(baseline.values()), local: fingerprint(local.values()), hosted: fingerprint(hosted.values()) };
  const keys = [...new Set([...baseline.keys(), ...local.keys(), ...hosted.keys()])].sort();
  const conflicts: AccountSyncConflict[] = [], mergedEntities: AccountSyncEntity[] = [];
  for (const key of keys) {
    const base = baseline.get(key) ?? null, left = local.get(key) ?? null, right = hosted.get(key) ?? null;
    if (base?.kind === "occurrence" && (!left || !right) && protectedOccurrences.has(base.id)) {
      const retained = left ?? right;
      if (retained && (!same(retained, base) || !baselineProtectedOccurrences.has(base.id))) conflicts.push(conflict(base, left, right, "delete_vs_update"));
      else mergedEntities.push(retained ?? base);
      continue;
    }
    const historyConflict = historyProblem(base, left, right);
    if (historyConflict === "history_rewrite" && base) {
      if (HISTORY.has(base.kind) && ((left && !same(left, base)) || (right && !same(right, base)))) throw new Error("The account snapshot rewrites append-only history.");
      const retained = left ?? right ?? base;
      mergedEntities.push(retained);
    }
    else if (historyConflict) throw new Error("The account snapshot contains incompatible append-only history.");
    else if (same(left, right)) { if (left) mergedEntities.push(left); }
    else if (same(left, base)) { if (right) mergedEntities.push(right); }
    else if (same(right, base)) { if (left) mergedEntities.push(left); }
    else if (left?.kind === "occurrence" && compatibleMarks.has(left.id)) mergedEntities.push(compatibleMarks.get(left.id)!);
    else if (hostedSendSupersedesCancellation(base, left, right)) mergedEntities.push(right);
    else conflicts.push(conflict(base, left, right, !base ? "append_id_collision" : !left || !right ? "delete_vs_update" : "concurrent_update"));
  }
  historyBranches(baseline, local, hosted, input.firstHostedHydration === true, compatibleMarks);
  if (conflicts.length) return { localWrites: [], hostedWrites: [], conflicts: uniqueConflicts(conflicts), mergedEntities: [], fingerprints: { ...fingerprints, merged: null }, idempotencyKey: null };
  const retained = reconcileOccurrenceReminders(
    retainReminderProcessingClaims(retainNoteShortcutExclusions(coalesceGeneratedOccurrences(mergedEntities, baseline, local, hosted), exclusionSources(input.noteShortcutExclusionPolicy, baseline, local, hosted)), baseline, local, hosted),
  );
  const merged = prepare({ entities: retained }), mergedRows = [...merged.values()].sort(compareEntity), mergedFingerprint = fingerprint(mergedRows);
  validateInputGraphs(false, merged);
  return { localWrites: writesBetween(local, merged), hostedWrites: writesBetween(hosted, merged), conflicts: [], mergedEntities: mergedRows, fingerprints: { ...fingerprints, merged: mergedFingerprint }, idempotencyKey: sha256(`${accountLinkId}:${fingerprints.baseline}:${fingerprints.local}:${fingerprints.hosted}:${mergedFingerprint}`) };
}

export function canKeepBothAccountSyncConflict(_conflict: AccountSyncConflict): boolean {
  // Synchronized rows carry identity and graph references. Duplicating one row alone cannot preserve both graphs.
  void _conflict;
  return false;
}

export function resolveReviewedAccountSync(input: Readonly<{
  accountLinkId?: string; baseline: AccountSyncSnapshot; local: AccountSyncSnapshot; hosted: AccountSyncSnapshot;
  reviewedFingerprints: Readonly<{ baseline: string; local: string; hosted: string }>;
  decisions: readonly AccountSyncConflictDecision[];
  firstLink?: boolean;
  noteShortcutExclusionPolicy?: NoteShortcutExclusionPolicy;
}>): AccountSyncPlan {
  const initial = resolveAccountSync(input);
  if (initial.fingerprints.baseline !== input.reviewedFingerprints.baseline || initial.fingerprints.local !== input.reviewedFingerprints.local || initial.fingerprints.hosted !== input.reviewedFingerprints.hosted) {
    throw new Error("The synchronization conflict review is stale. Review the current changes again.");
  }
  const decisions = new Map(input.decisions.map((decision) => [`${decision.kind}:${decision.id}`, decision]));
  const local = prepare(input.local), hosted = prepare(input.hosted);
  const protectedOccurrences = protectedOccurrenceIds(prepare(input.baseline), local, hosted);
  for (const conflict of initial.conflicts) {
    const key = `${conflict.kind}:${conflict.id}`, decision = decisions.get(key);
    if (!decision) throw new Error("Every synchronization conflict requires a decision.");
    if (conflict.kind === "occurrence"
      && protectedOccurrences.has(conflict.id)
      && ((decision.choice === "local" && conflict.local === null) || (decision.choice === "hosted" && conflict.hosted === null))) {
      throw new Error("An Occurrence with a Note, status history, tracked time, or resolved status cannot be deleted during synchronization.");
    }
    if (decision.choice === "hosted") replace(local, key, hosted.get(key) ?? null);
    else if (decision.choice === "local") replace(hosted, key, local.get(key) ?? null);
    else {
      if (!canKeepBothAccountSyncConflict(conflict) || !decision.duplicateId) throw new Error("Keep both is unavailable for this synchronization conflict.");
      throw new Error("Keep both is unavailable for this synchronization conflict.");
    }
  }
  removeOrphanReminders(local);
  removeOrphanReminders(hosted);
  const resolved = resolveAccountSync({ ...input, local: { entities: [...local.values()] }, hosted: { entities: [...hosted.values()] } });
  if (resolved.conflicts.length) throw new Error("The synchronization conflict decisions do not produce a valid account state.");
  const actualBaseline = prepare(input.baseline), actualLocal = prepare(input.local), actualHosted = prepare(input.hosted);
  const retained = retainReminderProcessingClaims(
    retainNoteShortcutExclusions(resolved.mergedEntities, exclusionSources(input.noteShortcutExclusionPolicy, actualBaseline, actualLocal, actualHosted)),
    actualBaseline, actualLocal, actualHosted,
  );
  const merged = prepare({ entities: retained }), mergedEntities = [...merged.values()].sort(compareEntity);
  validateInputGraphs(false, merged);
  const fingerprints = { baseline: initial.fingerprints.baseline, local: initial.fingerprints.local, hosted: initial.fingerprints.hosted, merged: fingerprint(merged.values()) };
  return { ...resolved, mergedEntities, localWrites: writesBetween(actualLocal, merged), hostedWrites: writesBetween(actualHosted, merged), fingerprints,
    idempotencyKey: sha256(`${input.accountLinkId ?? "account-link"}:${fingerprints.baseline}:${fingerprints.local}:${fingerprints.hosted}:${fingerprints.merged}`) };
}

/** Independently generated, untouched local Occurrences reuse the hosted schedule identity. */
function coalesceGeneratedOccurrences(rows: readonly AccountSyncEntity[], baseline: Map<string, AccountSyncEntity>, local: Map<string, AccountSyncEntity>, hosted: Map<string, AccountSyncEntity>): AccountSyncEntity[] {
  const retained = new Set(rows.map(entityKey));
  const hostedByIdentity = new Map([...hosted.values()].flatMap(entity => {
    const identity = occurrenceScheduleIdentity(entity);
    return identity && retained.has(entityKey(entity)) ? [[identity, entity.id] as const] : [];
  }));
  const protectedIds = protectedOccurrenceIds(baseline, local, hosted);
  for (const graph of [baseline, local, hosted]) for (const entity of graph.values()) {
    for (const [name, kind] of dependencies(entity)) {
      const id = field(entity.value, name);
      if (kind === "occurrence" && id) protectedIds.add(id);
    }
    if (entity.kind === "mapping" || entity.kind === "imported_note") {
      const id = field(entity.value, entity.kind === "mapping" ? "local_id" : "target_local_id");
      if (id) protectedIds.add(id);
    }
    if (entity.kind === "note_shortcut_state") for (const id of noteShortcutState(entity).excluded) protectedIds.add(id);
  }
  return rows.filter(entity => {
    const identity = occurrenceScheduleIdentity(entity);
    const hostedId = identity ? hostedByIdentity.get(identity) : undefined;
    if (!hostedId || hostedId === entity.id) return true;
    if (baseline.has(entityKey(entity)) || hosted.has(entityKey(entity)) || !local.has(entityKey(entity)) || protectedIds.has(entity.id)) {
      throw new Error("Duplicate scheduled Occurrences contain existing data; review is required before synchronization.");
    }
    return false;
  });
}

function occurrenceScheduleIdentity(entity: AccountSyncEntity): string | null {
  if (entity.kind !== "occurrence") return null;
  const behavior = field(entity.value, "behavior_id"), date = field(entity.value, "local_date");
  const start = field(entity.value, "schedule_start_time"), kind = field(entity.value, "schedule_kind"), end = field(entity.value, "schedule_end_time");
  if (!behavior || !date || !start || (kind !== "exact" && kind !== "range") || (kind === "range" && !end)) return null;
  return JSON.stringify([behavior, Temporal.PlainDate.from(date).toString(), Temporal.PlainTime.from(start).toString(),
    kind === "range" ? Temporal.PlainTime.from(end!).toString() : null]);
}

function exclusionSources(policy: NoteShortcutExclusionPolicy | undefined, baseline: Map<string, AccountSyncEntity>, local: Map<string, AccountSyncEntity>, hosted: Map<string, AccountSyncEntity>) {
  return policy === "discard_local" ? [hosted] : [baseline, local, hosted];
}

function retainNoteShortcutExclusions(mergedEntities: readonly AccountSyncEntity[], sources: readonly Map<string, AccountSyncEntity>[]): AccountSyncEntity[] {
  const merged = new Map(mergedEntities.map((entity) => [entityKey(entity), entity]));
  const sourceRows = new Map<string, AccountSyncEntity[]>();
  for (const source of sources) for (const entity of source.values()) {
    if (entity.kind !== "note_shortcut_state") continue;
    const key = entityKey(entity);
    sourceRows.set(key, [...(sourceRows.get(key) ?? []), entity]);
  }
  for (const [key, rows] of sourceRows) {
    const winner = merged.get(key) ?? null;
    const candidates = winner ? [...rows, winner] : rows;
    const excluded = new Set<string>();
    let behaviorId: string | null | undefined;
    let revision = -1;
    let updatedAt = "";
    for (const candidate of candidates) {
      const state = noteShortcutState(candidate);
      if (behaviorId !== undefined && behaviorId !== state.behaviorId) throw new Error("The Note shortcut state identity changed during synchronization.");
      behaviorId = state.behaviorId;
      revision = Math.max(revision, state.revision);
      if (compareText(updatedAt, state.updatedAt) < 0) updatedAt = state.updatedAt;
      for (const id of state.excluded) {
        excluded.add(id);
        if (excluded.size > ACCOUNT_SYNC_ROW_LIMIT) throw new Error("Note shortcut exclusions exceed 100,000 Occurrences.");
      }
    }
    const retained = [...excluded].sort(compareText);
    if (winner) {
      const state = noteShortcutState(winner);
      if (sameStrings(state.excluded, retained)) continue;
      const nextRevision = incrementRevision(revision);
      merged.set(key, { ...winner, value: { ...(winner.value as Record<string, Json>), excluded_occurrence_ids: retained, revision: nextRevision, updated_at: updatedAt } });
    } else if (retained.length && behaviorId && merged.has(`behavior:${behaviorId}`)) {
      merged.set(key, { kind: "note_shortcut_state", id: key.slice("note_shortcut_state:".length), value: {
        id: key.slice("note_shortcut_state:".length), behavior_id: behaviorId, enabled: false, entries: [],
        excluded_occurrence_ids: retained, revision: incrementRevision(revision), updated_at: updatedAt,
      } });
    }
  }
  return [...merged.values()].sort(compareEntity);
}

function noteShortcutState(entity: AccountSyncEntity): { behaviorId: string | null; excluded: string[]; revision: number; updatedAt: string } {
  const value = entity.value;
  if (entity.kind !== "note_shortcut_state" || !value || Array.isArray(value) || typeof value !== "object"
    || value.id !== entity.id) throw new Error("The Note shortcut state is invalid for synchronization.");
  try {
    const state = { ...value, user_id: SYNC_NOTE_SHORTCUT_OWNER_ID };
    validateNoteShortcutState(state);
    return { behaviorId: state.behavior_id, excluded: state.excluded_occurrence_ids, revision: state.revision, updatedAt: state.updated_at };
  }
  catch { throw new Error("The Note shortcut state is invalid for synchronization."); }
}

function incrementRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision >= NOTE_SHORTCUT_LIMITS.revision) throw new Error("The Note shortcut revision cannot be advanced safely.");
  return revision + 1;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function replace(target: Map<string, AccountSyncEntity>, key: string, value: AccountSyncEntity | null) { if (value) target.set(key, value); else target.delete(key); }
function writesBetween(previous: Map<string, AccountSyncEntity>, next: Map<string, AccountSyncEntity>): AccountSyncWrite[] {
  return [...new Set([...previous.keys(), ...next.keys()])].sort().flatMap((key) => same(previous.get(key) ?? null, next.get(key) ?? null) ? [] : [writeFor(previous.get(key) ?? null, next.get(key) ?? null)])
    .sort((left, right) => writeOrder(left) - writeOrder(right) || compareText(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`));
}

function writeOrder(write: AccountSyncWrite): number {
  if (write.operation !== "delete") return 0;
  if (write.kind === "reminder_delivery") return 1;
  if (write.kind === "occurrence") return 2;
  return 1;
}

function reconcileOccurrenceReminders(entities: readonly AccountSyncEntity[]): AccountSyncEntity[] {
  const occurrenceIds = new Set(entities.filter(({ kind }) => kind === "occurrence").map(({ id }) => id));
  return entities.filter((entity) => {
    if (entity.kind !== "reminder_delivery") return true;
    const occurrenceId = field(entity.value, "occurrence_id");
    return occurrenceId === null || occurrenceIds.has(occurrenceId);
  });
}

function hostedSendSupersedesCancellation(base: AccountSyncEntity | null, local: AccountSyncEntity | null, hosted: AccountSyncEntity | null): hosted is AccountSyncEntity {
  if (base?.kind !== "reminder_delivery" || local?.kind !== "reminder_delivery" || hosted?.kind !== "reminder_delivery"
    || field(base.value, "status") !== "pending" || field(local.value, "status") !== "cancelled"
    || field(hosted.value, "status") !== "sent") return false;
  const rows = [base, local, hosted];
  if (!rows.every((row) => field(row.value, "id") === row.id)
    || !["browser_push", "email"].includes(field(hosted.value, "channel") ?? "")
    || field(base.value, "sent_at") !== null || field(local.value, "sent_at") !== null) return false;
  const sentAt = field(hosted.value, "sent_at"), scheduledAt = field(hosted.value, "scheduled_send_at");
  if (!sentAt || !scheduledAt) return false;
  try { Temporal.Instant.from(sentAt); Temporal.Instant.from(scheduledAt); } catch { return false; }
  const claim = field(hosted.value, "processing_started_at");
  if ([base, local].some((row) => {
    const existing = field(row.value, "processing_started_at");
    return existing !== null && existing !== claim;
  })) return false;
  // A recorded hosted send survives a stale local cancellation, never a changed delivery identity or schedule.
  const identities = rows.map((row) => canonical(Object.fromEntries(Object.entries(row.value as Record<string, Json>)
    .filter(([key]) => !["status", "error", "sent_at", "processing_started_at", "updated_at"].includes(key)))));
  return identities[0] === identities[1] && identities[0] === identities[2];
}

function retainReminderProcessingClaims(entities: readonly AccountSyncEntity[], ...sources: readonly Map<string, AccountSyncEntity>[]): AccountSyncEntity[] {
  return entities.map((entity) => {
    if (entity.kind !== "reminder_delivery" || !entity.value || Array.isArray(entity.value) || typeof entity.value !== "object"
      || field(entity.value, "processing_started_at") !== null) return entity;
    // A reviewed cancellation cannot erase a processing claim on either database.
    const claim = sources.map((source) => field(source.get(entityKey(entity))?.value ?? null, "processing_started_at"))
      .find((value) => value !== null);
    return claim ? { ...entity, value: { ...entity.value, processing_started_at: claim } } : entity;
  });
}

function removeOrphanReminders(graph: Map<string, AccountSyncEntity>): void {
  for (const [key, entity] of graph) {
    if (entity.kind === "reminder_delivery") {
      const occurrenceId = field(entity.value, "occurrence_id");
      if (occurrenceId && !graph.has(`occurrence:${occurrenceId}`)) graph.delete(key);
    }
  }
}

function protectedOccurrenceIds(...graphs: readonly Map<string, AccountSyncEntity>[]): Set<string> {
  const protectedIds = new Set<string>();
  for (const graph of graphs) for (const entity of graph.values()) {
    if (entity.kind === "occurrence") {
      const status = field(entity.value, "status");
      const note = field(entity.value, "note");
      if (status !== "unresolved" || (note !== null && note.trim() !== "")) protectedIds.add(entity.id);
    } else if (entity.kind === "status_event" || entity.kind === "time_session") {
      const occurrenceId = field(entity.value, "occurrence_id");
      if (occurrenceId) protectedIds.add(occurrenceId);
    }
  }
  return protectedIds;
}

function validateInputGraphs(allowEmptyBaseline: boolean, ...graphs: readonly Map<string, AccountSyncEntity>[]): void {
  for (const [index, graph] of graphs.entries()) {
    if (index === 0 && allowEmptyBaseline && graph.size === 0) continue;
    if (!graph.has("profile:profile")) throw new Error("Account synchronization requires complete baseline, local, and hosted graphs with a profile.");
    for (const entity of graph.values()) for (const [fieldName, parentKind] of dependencies(entity)) {
      const parentId = field(entity.value, fieldName);
      if (!parentId && requiredDependency(entity.kind, fieldName)) {
        throw new Error(`The account ${entity.kind} ${entity.id} is missing required reference ${fieldName}; read a complete graph before synchronizing.`);
      }
      if (parentId && !graph.has(`${parentKind}:${parentId}`)) {
        throw new Error(`The account ${entity.kind} ${entity.id} references missing ${parentKind} ${parentId}; read a complete graph before synchronizing.`);
      }
    }
  }
}

function requiredDependency(kind: AccountSyncEntityKind, fieldName: string): boolean {
  return !(
    (kind === "behavior" && (fieldName === "category_id" || fieldName === "current_configuration_event_id"))
    || (kind === "schedule_slot" && fieldName === "behavior_schedule_id")
    || (kind === "occurrence" && (fieldName === "behavior_configuration_event_id" || fieldName === "behavior_schedule_slot_id"))
    || (kind === "status_event" && fieldName === "revises_event_id")
    || (kind === "import_run" && fieldName === "accepted_preview_run_id")
    || (kind === "imported_intervention" && (fieldName === "behavior_id" || fieldName === "occurrence_id"))
    || (kind === "reminder_delivery" && (fieldName === "import_run_id" || fieldName === "imported_intervention_id"))
    || kind === "note_shortcut_state"
  );
}

function dependencies(entity: AccountSyncEntity): readonly (readonly [string, AccountSyncEntityKind])[] {
  switch (entity.kind) {
    case "behavior": return [["category_id", "category"], ["current_configuration_event_id", "configuration_event"]];
    case "schedule":
    case "definition_event":
    case "configuration_event": return [["behavior_id", "behavior"]];
    case "schedule_slot": return [["behavior_id", "behavior"], ["behavior_schedule_id", "schedule"]];
    case "occurrence": return [["behavior_id", "behavior"], ["behavior_configuration_event_id", "configuration_event"], ["behavior_schedule_slot_id", "schedule_slot"]];
    case "status_event": return [["behavior_id", "behavior"], ["occurrence_id", "occurrence"], ["revises_event_id", "status_event"]];
    case "time_session": return [["behavior_id", "behavior"], ["occurrence_id", "occurrence"]];
    case "import_run": return [["accepted_preview_run_id", "import_run"]];
    case "mapping":
    case "imported_note": return [["import_run_id", "import_run"]];
    case "imported_intervention": return [["import_run_id", "import_run"], ["behavior_id", "behavior"], ["occurrence_id", "occurrence"]];
    case "reminder_delivery": return [["occurrence_id", "occurrence"], ["import_run_id", "import_run"], ["imported_intervention_id", "imported_intervention"]];
    case "note_shortcut_state": return [["behavior_id", "behavior"]];
    default: return [];
  }
}

function prepare(snapshot: AccountSyncSnapshot): Map<string, AccountSyncEntity> {
  const counts = new Map<AccountSyncEntityKind, number>(), result = new Map<string, AccountSyncEntity>();
  for (const source of snapshot.entities) {
    if (!source.id) throw new Error("Account synchronization entities require an id.");
    const count = (counts.get(source.kind) ?? 0) + 1;
    if (count > ACCOUNT_SYNC_ROW_LIMIT) throw new Error(`The account ${source.kind} collection exceeds 100,000 rows.`);
    counts.set(source.kind, count);
    const entity = normalize(source), key = entityKey(entity);
    if (entity.kind === "note_shortcut_state") noteShortcutState(entity);
    if (result.has(key)) throw new Error(`Duplicate account synchronization entity: ${key}.`);
    result.set(key, entity);
  }
  if (utf8Bytes(canonical([...result.values()].sort(compareEntity))) > ACCOUNT_SYNC_BYTE_LIMIT) throw new Error("The account snapshot exceeds 64 MiB.");
  return result;
}

function normalize(entity: AccountSyncEntity): AccountSyncEntity {
  if (entity.kind === "profile") {
    const value = entity.value && !Array.isArray(entity.value) && typeof entity.value === "object" ? entity.value : {};
    const normalized = normalizeRow({
      timezone: typeof value.timezone === "string" ? value.timezone : null,
      travel_enabled: value.travel_enabled === true,
      base_location_text: typeof value.base_location_text === "string" ? value.base_location_text : null,
      travel_mode: typeof value.travel_mode === "string" ? value.travel_mode : null,
      navigation_preference: typeof value.navigation_preference === "string" ? value.navigation_preference : null,
      routing_consent_at: typeof value.routing_consent_at === "string" ? value.routing_consent_at : null,
      onboarding_completed_at: typeof value.onboarding_completed_at === "string" ? value.onboarding_completed_at : null,
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
      // Ticket 217 learned habits. Baselines saved before them read as nothing learned.
      ...travelHabitSyncJson(profileTravelHabits(value)),
    });
    validateProfileSyncValue(normalized);
    return { kind: "profile", id: "profile", value: normalized };
  }
  let value = stripOwnership(entity.value);
  if (entity.kind === "note_shortcut_state") noteShortcutState({ ...entity, value });
  value = normalizeRow(value);
  if (entity.kind === "behavior" && value && !Array.isArray(value) && typeof value === "object") {
    // Older saved baselines predate these columns. Normalization keeps them
    // comparable while every generated write carries the complete row shape.
    value = {
      archive_notes: [],
      default_duration_minutes: null,
      end_date: null,
      auto_archived_at: null,
      location_text: null,
      ...value,
    };
    // Rows written before Ticket 215 carry only location text, which meant A place.
    if (!("where_kind" in value)) value = { ...value, where_kind: typeof value.location_text === "string" ? "place" : null };
    parseArchiveNotes(value.archive_notes);
    validateBehaviorPersistenceFields(value);
  }
  return { kind: entity.kind, id: entity.id, value };
}

function profileTravelHabits(value: Readonly<Record<string, Json | undefined>>) {
  try { return travelHabitsFromSyncValue(value); }
  catch { throw new Error("The synced travel habits are invalid."); }
}

function validateProfileSyncValue(value: Json): void {
  if (!value || Array.isArray(value) || typeof value !== "object"
    || typeof value.timezone !== "string"
    || typeof value.travel_enabled !== "boolean"
    || !(value.base_location_text === null || typeof value.base_location_text === "string")
    || !(value.travel_mode === null || ["walking", "cycling", "transit", "driving"].includes(String(value.travel_mode)))
    || !(value.navigation_preference === null || ["google_maps", "apple_maps"].includes(String(value.navigation_preference)))
    || !(value.routing_consent_at === null || typeof value.routing_consent_at === "string")
    || !(value.onboarding_completed_at === null || typeof value.onboarding_completed_at === "string")
    || !(value.updated_at === null || typeof value.updated_at === "string")
    || (value.travel_enabled && (!value.travel_mode || !value.routing_consent_at))) {
    throw new Error("The synced travel settings are invalid.");
  }
}

function validateBehaviorPersistenceFields(value: Record<string, Json | undefined>): void {
  const duration = value.default_duration_minutes;
  if (duration !== null
    && (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 1_440)) {
    throw new Error("The account Behavior default duration is invalid.");
  }
  const endDate = value.end_date;
  if (endDate !== null) {
    if (typeof endDate !== "string") throw new Error("The account Behavior end date is invalid.");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < "0001-01-01"
        || Temporal.PlainDate.from(endDate).toString() !== endDate) throw new Error();
    } catch { throw new Error("The account Behavior end date is invalid."); }
  }
  const autoArchivedAt = value.auto_archived_at;
  if (autoArchivedAt !== null) {
    if (typeof autoArchivedAt !== "string") throw new Error("The account automatic archive marker is invalid.");
    try { Temporal.Instant.from(autoArchivedAt); }
    catch { throw new Error("The account automatic archive marker is invalid."); }
    if (value.active !== false || typeof value.archived_at !== "string") {
      throw new Error("The account automatic archive marker requires an archived Behavior.");
    }
  }
  const locationText = value.location_text;
  if (locationText !== null && (typeof locationText !== "string" || locationText.trim() !== locationText
    || locationText.length < 1 || locationText.length > 500 || /[\u0000-\u001f\u007f]/u.test(locationText))) {
    throw new Error("The account Behavior location is invalid.");
  }
  const whereKind = value.where_kind;
  if (!(whereKind === null || whereKind === "anywhere" || whereKind === "home" || whereKind === "place")
    || (whereKind === "place") !== (locationText !== null)) {
    throw new Error("The account Behavior Where is invalid.");
  }
}
function normalizeRow(value: Json): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "schedule_range_identity").map(([key, item]) => {
    if (!(key.endsWith("_at") || key === "scheduled_for") || typeof item !== "string") return [key, item];
    try {
      const instant = Temporal.Instant.from(item).round({ smallestUnit: "microsecond", roundingMode: "halfEven" });
      return [key, instant.toString({ fractionalSecondDigits: 6 })];
    } catch { return [key, item]; }
  })) as Json;
}
function stripOwnership(value: Json): Json {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, Json] => entry[0] !== "user_id" && entry[1] !== undefined)
  ) as Json;
}
function historyProblem(base: AccountSyncEntity | null, left: AccountSyncEntity | null, right: AccountSyncEntity | null): AccountSyncConflict["reason"] | null {
  const sample = base ?? left ?? right;
  if (!sample) return null;
  if (base && protectedDelete(sample) && (!left || !right)) return "history_rewrite";
  if (!HISTORY.has(sample.kind)) return null;
  if (base && (!same(base, left) || !same(base, right))) return "history_rewrite";
  if (!base && left && right && !same(left, right)) return "append_id_collision";
  return null;
}
function protectedDelete(entity: AccountSyncEntity): boolean {
  return PROTECTED_DELETE.has(entity.kind) || (entity.kind === "occurrence" && field(entity.value, "status") !== "unresolved");
}
// Equal initial manual marks carry the same decision, but retain distinct audit evidence.
// Corrections and divergent descendants require causal resolution, not timestamp arbitration.
function compatibleInitialMarks(baseline: Map<string, AccountSyncEntity>, local: Map<string, AccountSyncEntity>, hosted: Map<string, AccountSyncEntity>): Map<string, AccountSyncEntity> {
  const events = new Map<string, Map<string, AccountSyncEntity>>(), result = new Map<string, AccountSyncEntity>();
  const priorOccurrences = new Set([...baseline.values()].filter(({ kind }) => kind === "status_event").map((row) => field(row.value, "occurrence_id")));
  for (const graph of [local, hosted]) for (const row of graph.values()) {
    if (row.kind !== "status_event") continue;
    const occurrenceId = field(row.value, "occurrence_id");
    if (!occurrenceId || priorOccurrences.has(occurrenceId)) continue;
    if (!events.has(occurrenceId)) events.set(occurrenceId, new Map());
    events.get(occurrenceId)!.set(row.id, row);
  }
  for (const [id, byId] of events) {
    const rows = [...byId.values()], base = baseline.get(`occurrence:${id}`), left = local.get(`occurrence:${id}`), right = hosted.get(`occurrence:${id}`);
    if (rows.length < 2 || !base || !left || !right || field(base.value, "status") !== "unresolved") continue;
    const status = field(left.value, "status"), behaviorId = field(left.value, "behavior_id");
    if (!["completed", "not_completed"].includes(status ?? "") || field(right.value, "status") !== status
      || field(left.value, "id") !== id || field(right.value, "id") !== id
      || withoutFields(left.value, ["completed_at", "status_marked_at", "updated_at"]) !== withoutFields(right.value, ["completed_at", "status_marked_at", "updated_at"])) continue;
    const evidence = withoutFields(rows[0].value, ["id", "recorded_at", "effective_at", "created_at", "updated_at"]);
    if (!rows.every((row) => field(row.value, "id") === row.id && field(row.value, "behavior_id") === behaviorId
      && field(row.value, "status") === status && field(row.value, "previous_status") === "unresolved"
      && field(row.value, "revises_event_id") === null && field(row.value, "status_semantics") === "explicit_user_mark"
      && field(row.value, "source_capture_method") === "manual_tap" && field(row.value, "source_confidence") === "high"
      && withoutFields(row.value, ["id", "recorded_at", "effective_at", "created_at", "updated_at"]) === evidence)) continue;
    try {
      for (const row of rows) for (const key of ["recorded_at", "effective_at", "created_at"]) Temporal.Instant.from(field(row.value, key) ?? "");
    } catch { continue; }
    const matches = (occurrence: AccountSyncEntity, event: AccountSyncEntity) => field(occurrence.value, "status_marked_at") === field(event.value, "recorded_at")
      && (status === "completed" ? field(occurrence.value, "completed_at") === field(event.value, "effective_at")
        : field(occurrence.value, "completed_at") === null && field(occurrence.value, "status_marked_at") === field(event.value, "effective_at"));
    if (!rows.some((row) => local.has(entityKey(row)) && matches(left, row))
      || !rows.some((row) => hosted.has(entityKey(row)) && matches(right, row))) continue;
    // Match existing latest-event ordering only to select display timestamps for an agreed status.
    rows.sort((a, b) => Temporal.Instant.compare(field(a.value, "recorded_at")!, field(b.value, "recorded_at")!)
      || Temporal.Instant.compare(field(a.value, "created_at")!, field(b.value, "created_at")!) || compareText(a.id, b.id));
    const latest = rows[rows.length - 1];
    if (matches(left, latest)) result.set(id, left);
    else if (matches(right, latest)) result.set(id, right);
  }
  return result;
}

function withoutFields(value: Json, excluded: readonly string[]): string {
  return canonical(Object.fromEntries(Object.entries(value as Record<string, Json>).filter(([key]) => !excluded.includes(key))));
}

function historyBranches(baseline: Map<string, AccountSyncEntity>, local: Map<string, AccountSyncEntity>, hosted: Map<string, AccountSyncEntity>, firstHostedHydration: boolean, compatibleMarks: ReadonlyMap<string, AccountSyncEntity>): void {
  const successors = (rows: Map<string, AccountSyncEntity>) => {
    const result = new Map<string, AccountSyncEntity[]>();
    for (const row of rows.values()) {
      if (row.kind !== "status_event" || baseline.has(entityKey(row))) continue;
      const predecessor = field(row.value, "revises_event_id") ?? `root:${field(row.value, "occurrence_id") ?? row.id}`;
      result.set(predecessor, [...(result.get(predecessor) ?? []), row]);
    }
    return result;
  };
  const left = successors(local), right = successors(hosted);
  const hasStatusBaseline = [...baseline.values()].some(({ kind }) => kind === "status_event");
  for (const predecessor of new Set([...left.keys(), ...right.keys()])) {
    const localRows = [...new Map((left.get(predecessor) ?? []).map((row) => [row.id, row])).values()];
    const hostedRows = [...new Map((right.get(predecessor) ?? []).map((row) => [row.id, row])).values()];
    const hostedIds = new Set(hostedRows.map(({ id }) => id));
    const status = field(hostedRows[0]?.value ?? null, "status");
    if (firstHostedHydration && !hasStatusBaseline && hostedRows.length > 1 && status !== null
      && hostedRows.every((row) => field(row.value, "status") === status) && localRows.every(({ id }) => hostedIds.has(id))) continue;
    if ([...localRows, ...hostedRows].every((row) => compatibleMarks.has(field(row.value, "occurrence_id") ?? ""))) continue;
    if (localRows.length > 1) throw new Error("The local account snapshot contains branched status history.");
    if (hostedRows.length > 1) throw new Error("The hosted account snapshot contains branched status history.");
    if (localRows[0] && hostedRows[0] && localRows[0].id !== hostedRows[0].id) throw new Error("The account snapshot contains branched status history.");
  }
}
function field(value: Json, key: string): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}
function same(left: AccountSyncEntity | null, right: AccountSyncEntity | null): boolean { return left === right || (left !== null && right !== null && canonical(comparableValue(sameShape(left))) === canonical(comparableValue(sameShape(right)))); }
// The September 22, 2026 hosted travel migration canonicalized every configuration event:
// configurations gained `location_text: null` and baseline changed_fields gained "location_text".
// Compare pre-travel local/baseline rows in that canonical shape; fingerprints keep raw values.
// Ticket 215 rewrote no history: snapshots without `where_kind` derive it when read.
function sameShape(entity: AccountSyncEntity): Json {
  const value = entity.value;
  if (entity.kind !== "configuration_event" || !value || Array.isArray(value) || typeof value !== "object") return value;
  const next: Record<string, Json | undefined> = { ...value };
  for (const key of ["previous_configuration", "next_configuration"]) {
    const configuration = next[key];
    if (configuration && !Array.isArray(configuration) && typeof configuration === "object" && !("location_text" in configuration)) next[key] = { ...configuration, location_text: null };
  }
  const fields = next.changed_fields;
  if (next.event_kind === "baseline" && Array.isArray(fields) && fields.every((item) => typeof item === "string") && !fields.includes("location_text")) next.changed_fields = [...fields, "location_text"];
  return next as Json;
}
function writeFor(previous: AccountSyncEntity | null, next: AccountSyncEntity | null): AccountSyncWrite {
  const entity = next ?? previous;
  if (!entity) throw new Error("Account synchronization cannot write an unknown entity.");
  return next ? { kind: next.kind, id: next.id, operation: "upsert", expected: previous?.value ?? null, value: next.value } : { kind: entity.kind, id: entity.id, operation: "delete", expected: entity.value };
}
function conflict(base: AccountSyncEntity | null, local: AccountSyncEntity | null, hosted: AccountSyncEntity | null, reason: AccountSyncConflict["reason"]): AccountSyncConflict {
  const sample = local ?? hosted ?? base;
  if (!sample) throw new Error("Account synchronization cannot report an unknown entity.");
  return { kind: sample.kind, id: sample.id, reason, baseline: base?.value ?? null, local: local?.value ?? null, hosted: hosted?.value ?? null };
}
function uniqueConflicts(values: AccountSyncConflict[]): AccountSyncConflict[] { return [...new Map(values.map((value) => [`${value.kind}:${value.id}:${value.reason}`, value])).values()].sort((a, b) => compareText(`${a.kind}:${a.id}:${a.reason}`, `${b.kind}:${b.id}:${b.reason}`)); }
function entityKey(entity: AccountSyncEntity): string { return `${entity.kind}:${entity.id}`; }
function compareEntity(left: AccountSyncEntity, right: AccountSyncEntity): number { return compareText(entityKey(left), entityKey(right)); }
function compareText(left: string, right: string): number {
  const leftPoints = Array.from(left), rightPoints = Array.from(right);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    const difference = leftPoints[index].codePointAt(0)! - rightPoints[index].codePointAt(0)!;
    if (difference) return difference < 0 ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}
function fingerprint(entities: Iterable<AccountSyncEntity>): string {
  return sha256(canonical([...entities].sort(compareEntity).map((entity) => ({ ...entity, value: comparableValue(entity.value) }))));
}
function comparableValue(value: Json): Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updated_at")) as Json;
}
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
}
function canonical(value: Json | readonly AccountSyncEntity[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item as Json)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item as Json)}`).join(",")}}`;
  return JSON.stringify(value);
}
