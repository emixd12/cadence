import { Temporal } from "@js-temporal/polyfill";
import { sha256 } from "../hash";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "./day-note.resolver";
import type { NoteShortcut, NoteShortcutCommand, NoteShortcutContext, NoteShortcutState, NoteSource } from "../types/note-shortcut";

export const NOTE_SHORTCUT_LIMITS = { notes: 100, days: 90, evidence: 3, proposals: 5, characters: 160, sourceCharacters: 2_000, accepted: 20, entries: 128, exclusions: 100_000, revision: 2_147_483_647 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const INSTRUCTION = /\b(?:ignore|disregard|override)\b.{0,80}\b(?:previous|instructions?|prompts?|system|developer)\b|\b(?:output|return|respond with)\b.{0,80}\b(?:status|json|instructions?|secrets?|credentials)\b|(?:system|assistant|developer)\s*:|<\|(?:im_start|im_end|system)|\b(?:system prompt|developer message|output a completed status)\b/i;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const onlyKeys = (value: object, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const compareScheduled = (a: string | null, b: string | null) => a && b ? Temporal.Instant.compare(a, b) : a ? 1 : b ? -1 : 0;
export const isDayNoteShortcutPool = (poolId: string | null): boolean => poolId === DAY_NOTE_SHORTCUT_POOL_ID;

export function normalizeNoteShortcutText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ");
}
export function notePatternKey(text: string): string {
  return sha256(normalizeNoteShortcutText(text).toLowerCase());
}
// Include content as well as the counter: independent devices can have equal revisions.
export function noteShortcutRevision(state: NoteShortcutState | null): string {
  return sha256(JSON.stringify(state ? [state.id, state.user_id, state.behavior_id,
    state.enabled, state.revision, state.entries.map((entry) => [entry.key, entry.text,
      entry.status, entry.source, entry.evidence.map((ref) => [ref.occurrence_id, ref.note_hash]),
      entry.created_at, entry.expires_at]), state.excluded_occurrence_ids] : null));
}
export function validateNoteShortcutText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter shortcut text.");
  const text = normalizeNoteShortcutText(value);
  if (!text || [...text].length > NOTE_SHORTCUT_LIMITS.characters || CONTROL.test(text) || INSTRUCTION.test(text)) {
    throw new Error("Use plain shortcut text of 1–160 characters without instructions.");
  }
  return text;
}

export function eligibleNoteSources(input: { context: NoteShortcutContext; userId: string; now: Temporal.Instant }): NoteSource[] {
  const { context, userId, now } = input;
  const behavior = context.behavior;
  const dayPool = context.dayPool;
  // The day-note pool reads only day notes; a Behavior pool reads only that Behavior's Occurrence notes.
  if (dayPool ? behavior || dayPool.user_id !== userId : !behavior || behavior.user_id !== userId || !behavior.active) return [];
  const poolBehaviorId = dayPool ? null : behavior!.id;
  const today = now.toZonedDateTimeISO(dayPool ? dayPool.timezone : behavior!.timezone).toPlainDate();
  const firstDate = today.subtract({ days: NOTE_SHORTCUT_LIMITS.days - 1 }).toString();
  const lastDate = today.toString();
  const excluded = new Set([...(context.state?.excluded_occurrence_ids ?? []), ...context.importedOccurrenceIds]);
  const seen = new Set<string>();
  return [...context.notes].sort((a, b) => compare(b.local_date, a.local_date) || compareScheduled(b.scheduled_for, a.scheduled_for) || compare(a.id, b.id))
    .filter((note) => {
      if (note.user_id !== userId || note.behavior_id !== poolBehaviorId || (note.scheduled_for === null) !== Boolean(dayPool) || seen.has(note.id) || excluded.has(note.id) || note.local_date < firstDate || note.local_date > lastDate || !note.note?.trim() || [...note.note].length > NOTE_SHORTCUT_LIMITS.sourceCharacters) return false;
      seen.add(note.id);
      return true;
    }).slice(0, NOTE_SHORTCUT_LIMITS.notes);
}

export function currentNoteShortcuts(input: { context: NoteShortcutContext; userId: string; now: Temporal.Instant }): NoteShortcut[] {
  const sources = new Map(eligibleNoteSources(input).map((row) => [row.id, sha256(row.note!)]));
  return (input.context.state?.entries ?? []).filter((entry) => {
    if (entry.status === "accepted") return true;
    if (!entry.expires_at || Temporal.Instant.compare(entry.expires_at, input.now) <= 0) return false;
    return entry.status === "dismissed" || new Set(entry.evidence.filter((ref) => sources.get(ref.occurrence_id) === ref.note_hash).map((ref) => ref.occurrence_id)).size >= NOTE_SHORTCUT_LIMITS.evidence;
  });
}

export function resolveNoteSuggestions(input: { context: NoteShortcutContext; userId: string; now: Temporal.Instant }): NoteShortcut[] {
  const retained = currentNoteShortcuts(input).filter((entry) => entry.status !== "proposed");
  const suppressed = new Set(retained.flatMap((entry) => [entry.key, ...(entry.text ? [notePatternKey(entry.text)] : [])]));
  const groups = new Map<string, { text: string; notes: NoteSource[] }>();
  for (const note of eligibleNoteSources(input)) {
    let text: string;
    try { text = validateNoteShortcutText(note.note); } catch { continue; }
    const key = notePatternKey(text);
    if (suppressed.has(key)) continue;
    const group = groups.get(key) ?? { text, notes: [] };
    group.notes.push(note);
    groups.set(key, group);
  }
  const proposals: NoteShortcut[] = [...groups].filter(([, group]) => group.notes.length >= NOTE_SHORTCUT_LIMITS.evidence)
    .sort(([a, left], [b, right]) => right.notes.length - left.notes.length || compare(right.notes[0].local_date, left.notes[0].local_date) || compare(a, b))
    .slice(0, NOTE_SHORTCUT_LIMITS.proposals).map(([key, group]) => ({
      key, text: group.text, status: "proposed", source: "repeated_text",
      evidence: group.notes.map((note) => ({ occurrence_id: note.id, note_hash: sha256(note.note!) })),
      created_at: input.now.toString(), expires_at: input.now.add({ hours: 30 * 24 }).toString(),
    }));
  if (retained.length + proposals.length + retained.filter((entry) => entry.status === "accepted").length > NOTE_SHORTCUT_LIMITS.entries) throw new Error("The shortcut history is full. Try again after dismissed patterns expire.");
  return [...retained, ...proposals];
}

export function resolveNoteShortcutCommand(input: { context: NoteShortcutContext; userId: string; behaviorId: string | null; command: NoteShortcutCommand; now: Temporal.Instant }): NoteShortcutState {
  const { context, userId, behaviorId, command, now } = input;
  if (!command || typeof command !== "object" || !["enable", "analyze", "accept", "edit", "dismiss", "remove"].includes(command.operation)) throw new Error("Invalid Note shortcut command.");
  const commandKeys = command.operation === "enable" ? ["operation", "enabled"]
    : command.operation === "analyze" ? ["operation"]
    : command.operation === "accept" || command.operation === "edit" ? ["operation", "key", "text"]
    : ["operation", "key"];
  if (!onlyKeys(command, commandKeys) || commandKeys.some((key) => !Object.hasOwn(command, key))
    || (command.operation === "enable" && typeof command.enabled !== "boolean")
    || ("key" in command && (typeof command.key !== "string" || !HASH.test(command.key)))) throw new Error("Invalid Note shortcut command.");
  const dayPool = isDayNoteShortcutPool(behaviorId);
  const stateBehaviorId = dayPool ? null : behaviorId;
  if (dayPool && (!context.dayPool || context.dayPool.user_id !== userId || context.behavior)) throw new Error("Day note shortcuts are unavailable.");
  if (!dayPool && context.dayPool) throw new Error("Invalid Note shortcut context.");
  if (behaviorId && !dayPool && (!context.behavior || context.behavior.id !== behaviorId || context.behavior.user_id !== userId)) throw new Error("Behavior not found.");
  if (context.state) validateNoteShortcutState(context.state);
  if (context.globalState) validateNoteShortcutState(context.globalState);
  if (context.state && (context.state.user_id !== userId || context.state.id !== (behaviorId ?? "global") || context.state.behavior_id !== stateBehaviorId)) throw new Error("Shortcut state belongs to another owner or Behavior.");
  if (context.globalState && (context.globalState.user_id !== userId || context.globalState.id !== "global")) throw new Error("Global shortcut state belongs to another owner.");
  const state: NoteShortcutState = context.state ?? { id: behaviorId ?? "global", behavior_id: stateBehaviorId, user_id: userId, enabled: false, entries: [], excluded_occurrence_ids: [], revision: 0, updated_at: now.toString() };
  if (state.revision === NOTE_SHORTCUT_LIMITS.revision) throw new Error("The Note shortcut revision limit has been reached.");
  let entries = currentNoteShortcuts(input);
  let enabled = state.enabled;
  if (command.operation === "enable") enabled = command.enabled;
  else {
    if (!behaviorId) throw new Error("Choose a Behavior for shortcut management.");
    if (["analyze", "accept", "edit"].includes(command.operation) && (!context.globalState?.enabled || !state.enabled || (!dayPool && !context.behavior?.active))) throw new Error(dayPool ? "Enable Note shortcuts globally and for day notes first." : "Enable Note shortcuts globally and for this active Behavior first.");
    if (command.operation === "analyze") entries = resolveNoteSuggestions(input);
    else {
      const entry = entries.find((entry) => entry.key === command.key);
      if (!entry) throw new Error("This shortcut changed or expired. Refresh and try again.");
      if (command.operation === "accept" || command.operation === "edit") {
        if (entry.status !== (command.operation === "accept" ? "proposed" : "accepted")) throw new Error("This shortcut changed. Refresh and try again.");
        const text = validateNoteShortcutText(command.text);
        if (entries.some((other) => other.key !== entry.key && other.status === "accepted" && other.text && notePatternKey(other.text) === notePatternKey(text))) throw new Error("This shortcut is already accepted.");
        if (command.operation === "accept" && entries.filter((other) => other.status === "accepted").length >= NOTE_SHORTCUT_LIMITS.accepted) throw new Error(dayPool ? "Keep at most 20 accepted day note shortcuts." : "Keep at most 20 accepted shortcuts per Behavior.");
        entries = entries.map((other) => other.key === entry.key ? { ...other, text, status: "accepted", evidence: [], expires_at: null } : other);
        entries = entries.filter((other) => other.status !== "proposed" || !other.text || notePatternKey(other.text) !== notePatternKey(text));
      } else {
        if (entry.status !== (command.operation === "dismiss" ? "proposed" : "accepted")) throw new Error("This shortcut changed. Refresh and try again.");
        const dismissed: NoteShortcut = { ...entry, text: null, status: "dismissed", evidence: [], expires_at: now.add({ hours: 90 * 24 }).toString() };
        entries = entries.map((other) => other.key === entry.key ? dismissed : other);
        const editedKey = entry.text ? notePatternKey(entry.text) : entry.key;
        if (editedKey !== entry.key) {
          const existing = entries.find((other) => other.key === editedKey);
          if (!existing) entries.push({ ...dismissed, key: editedKey });
          else if (existing.status !== "accepted") {
            const expiresAt = existing.status === "dismissed" && existing.expires_at
              && Temporal.Instant.compare(existing.expires_at, dismissed.expires_at!) > 0
              ? existing.expires_at : dismissed.expires_at;
            entries = entries.map((other) => other.key === editedKey
              ? { ...other, text: null, status: "dismissed", evidence: [], expires_at: expiresAt }
              : other);
          }
        }
      }
    }
  }
  const result = { ...state, enabled, entries, revision: state.revision + 1, updated_at: now.toString() };
  if (entries.length + entries.filter((entry) => entry.status === "accepted").length > NOTE_SHORTCUT_LIMITS.entries) throw new Error("The shortcut history is full. Try again after dismissed patterns expire.");
  validateNoteShortcutState(result);
  return result;
}

export function validateNoteShortcutState(value: unknown): asserts value is NoteShortcutState {
  const fail = () => { throw new Error("Invalid Note shortcut state."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const state = value as NoteShortcutState;
  if (!onlyKeys(state, ["id", "user_id", "behavior_id", "enabled", "entries", "excluded_occurrence_ids", "revision", "updated_at"])) return fail();
  if (!UUID.test(state.user_id) || typeof state.enabled !== "boolean" || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision > NOTE_SHORTCUT_LIMITS.revision || !Array.isArray(state.entries) || !Array.isArray(state.excluded_occurrence_ids)) return fail();
  if (state.id === "global" ? state.behavior_id !== null || state.entries.length > 0 || state.excluded_occurrence_ids.length > 0
    : state.id === DAY_NOTE_SHORTCUT_POOL_ID ? state.behavior_id !== null
    : !UUID.test(state.id) || state.behavior_id !== state.id) return fail();
  if (state.entries.length > NOTE_SHORTCUT_LIMITS.entries || state.excluded_occurrence_ids.length > NOTE_SHORTCUT_LIMITS.exclusions || state.excluded_occurrence_ids.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(state.excluded_occurrence_ids).size !== state.excluded_occurrence_ids.length) return fail();
  try { Temporal.Instant.from(state.updated_at); } catch { return fail(); }
  const keys = new Set<string>();
  const acceptedTexts = new Set<string>();
  let accepted = 0, proposed = 0;
  for (const entry of state.entries) {
    if (!entry || !HASH.test(entry.key) || keys.has(entry.key) || !["proposed", "accepted", "dismissed"].includes(entry.status) || !["repeated_text", "model"].includes(entry.source) || !Array.isArray(entry.evidence) || entry.evidence.length > NOTE_SHORTCUT_LIMITS.notes) return fail();
    if (!onlyKeys(entry, ["key", "text", "status", "source", "evidence", "created_at", "expires_at"])) return fail();
    keys.add(entry.key);
    try { Temporal.Instant.from(entry.created_at); if (entry.expires_at !== null) Temporal.Instant.from(entry.expires_at); } catch { return fail(); }
    if (entry.status === "dismissed") { if (entry.text !== null || entry.evidence.length || entry.expires_at === null) return fail(); }
    else { if (validateNoteShortcutText(entry.text) !== entry.text) return fail(); }
    if (entry.status === "accepted") {
      accepted++;
      const textKey = notePatternKey(entry.text!);
      if (entry.expires_at !== null || entry.evidence.length || acceptedTexts.has(textKey)) return fail();
      acceptedTexts.add(textKey);
    }
    if (entry.status === "proposed") { proposed++; if (entry.expires_at === null || entry.evidence.length < NOTE_SHORTCUT_LIMITS.evidence) return fail(); }
    if (entry.evidence.some((ref) => !ref || !onlyKeys(ref, ["occurrence_id", "note_hash"]) || !UUID.test(ref.occurrence_id) || !HASH.test(ref.note_hash)) || new Set(entry.evidence.map((ref) => ref.occurrence_id)).size !== entry.evidence.length) return fail();
  }
  // Reserve one suppression slot per accepted shortcut so removal cannot hit capacity.
  if (accepted > NOTE_SHORTCUT_LIMITS.accepted || proposed > NOTE_SHORTCUT_LIMITS.proposals || state.entries.length + accepted > NOTE_SHORTCUT_LIMITS.entries) return fail();
}
