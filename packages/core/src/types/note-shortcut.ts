/** In the day-note pool, `occurrence_id` holds a day-note ID; the field name stays for storage and sync. */
export type NoteShortcutEvidence = { occurrence_id: string; note_hash: string };
export type NoteShortcut = {
  key: string;
  text: string | null;
  status: "proposed" | "accepted" | "dismissed";
  source: "repeated_text" | "model";
  evidence: NoteShortcutEvidence[];
  created_at: string;
  expires_at: string | null;
};
/** A pool is the global switch (`null`), one Behavior's ID, or `"day_notes"`. */
export type NoteShortcutPoolId = string | null;
export type NoteShortcutState = {
  /** `"global"`, `"day_notes"`, or the Behavior ID. Day-note exclusions are day-note IDs. */
  id: string;
  user_id: string;
  behavior_id: string | null;
  enabled: boolean;
  entries: NoteShortcut[];
  excluded_occurrence_ids: string[];
  revision: number;
  updated_at: string;
};
/** An Occurrence note, or a day note (`behavior_id` and `scheduled_for` null) in the day-note pool. */
export type NoteSource = {
  id: string;
  user_id: string;
  behavior_id: string | null;
  note: string | null;
  local_date: string;
  scheduled_for: string | null;
};
export type NoteShortcutContext = {
  state: NoteShortcutState | null;
  globalState: NoteShortcutState | null;
  behavior: { id: string; user_id: string; active: boolean; timezone: string } | null;
  notes: NoteSource[];
  importedOccurrenceIds: string[];
  /** Present only for the day-note pool: the owner's timezone for the 90-day window. */
  dayPool?: { user_id: string; timezone: string };
};
export type NoteShortcutStore = {
  userId: string;
  readStates(): Promise<NoteShortcutState[]>;
  readContext(poolId: NoteShortcutPoolId): Promise<NoteShortcutContext>;
  commit(input: { expected: NoteShortcutContext; next: NoteShortcutState; requireEnabled: boolean }): Promise<NoteShortcutState>;
};
export type NoteShortcutCommand =
  | { operation: "enable"; enabled: boolean }
  | { operation: "analyze" }
  | { operation: "accept" | "edit"; key: string; text: string }
  | { operation: "dismiss" | "remove"; key: string };
export type NoteShortcutView = {
  state: NoteShortcutState | null;
  globalEnabled: boolean;
  available: boolean;
  entries: NoteShortcut[];
  unavailable?: boolean;
};
