import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PERIOD_MESSAGES } from "@cadence/core/resolvers/period.resolver";
import { PERIOD_CONFLICT_MESSAGE, PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listPeriods } from "@/lib/db/periods.repo";
import {
  createPeriodFromFormData,
  deletePeriodFromFormData,
  endPeriodForUser,
  endPeriodFromFormData,
  listPeriodsForUser,
  periodTodayForUser,
  savePeriodNoteFromFormData,
  updatePeriodFromFormData,
} from "@/lib/services/period.service";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUserId: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

type Row = {
  id: string; user_id: string; label: string; start_on: string; end_on: string | null; note: string | null;
  revision: number; created_at: string; updated_at: string;
};
type Args = Record<string, string | number | null>;

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "50000000-0000-4000-8000-000000000001", user_id: "user-1", label: "Sick", start_on: "2026-11-03", end_on: null,
  note: null, revision: 1, created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-03T12:00:00Z", ...overrides,
});

// Stands in for the hosted project: the profile timezone, the periods table and the
// three functions with their compare-and-set on revision.
function hosted(input: { rows?: Row[]; timezone?: string | null; createError?: { code: string; message: string } } = {}) {
  const state = {
    rows: (input.rows ?? []).map((item) => ({ ...item })),
    calls: [] as Array<{ fn: string; args: Args }>,
    filters: [] as string[],
  };
  const table = (name: string) => {
    const filters: Array<(item: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: keyof Row, value: string) => { filters.push((item) => item[column] === value); state.filters.push(`eq:${column}`); return builder; },
      lte: (column: "start_on", value: string) => { filters.push((item) => item[column] <= value); state.filters.push(`lte:${column}:${value}`); return builder; },
      or: (expression: string) => {
        state.filters.push(`or:${expression}`);
        const from = expression.split("end_on.gte.")[1]!;
        filters.push((item) => item.end_on === null || item.end_on >= from);
        return builder;
      },
      order: () => builder,
      range: async (from: number, to: number) => ({ data: state.rows.filter((item) => filters.every((test) => test(item))).slice(from, to + 1), error: null }),
      maybeSingle: async () => name === "profiles"
        ? { data: input.timezone === null ? null : { email: "a@example.invalid", timezone: input.timezone ?? "America/New_York" }, error: null }
        : { data: state.rows.find((item) => filters.every((test) => test(item))) ?? null, error: null },
    };
    return builder;
  };
  const run = (fn: string, args: Args): { data: unknown; error: { code: string; message: string } | null } => {
    state.calls.push({ fn, args });
    if (fn === "create_period") {
      if (input.createError) return { data: null, error: input.createError };
      const created = row({
        id: "50000000-0000-4000-8000-0000000000aa", label: String(args.p_label), start_on: String(args.p_start_on),
        end_on: args.p_end_on as string | null, note: args.p_note as string | null,
      });
      state.rows.push(created);
      return { data: [created], error: null };
    }
    const index = state.rows.findIndex((item) => item.id === args.p_id && item.revision === args.p_expected_revision);
    if (index < 0) return { data: [], error: null };
    if (fn === "delete_period") return { data: [state.rows.splice(index, 1)[0]!.id], error: null };
    const next = {
      ...state.rows[index]!, label: String(args.p_label), start_on: String(args.p_start_on), end_on: args.p_end_on as string | null,
      note: args.p_note as string | null, revision: state.rows[index]!.revision + 1,
    };
    state.rows[index] = next;
    return { data: [next], error: null };
  };
  const supabase = {
    from: table,
    rpc: (fn: string, args: Args) => {
      const result = run(fn, args);
      const rows = Array.isArray(result.data) ? result.data : [];
      return Object.assign(Promise.resolve(result), { maybeSingle: async () => ({ data: rows[0] ?? null, error: result.error }) });
    },
  };
  return { state, supabase: supabase as unknown as AppSupabaseClient };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

function signedIn(input: Parameters<typeof hosted>[0] = {}) {
  const fake = hosted(input);
  vi.mocked(createClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

describe("period web service (Ticket 368)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUserId).mockResolvedValue("user-1");
  });

  it("creates from form fields, with an empty last day as ongoing and an empty note as none", async () => {
    const { state } = signedIn();
    const result = await createPeriodFromFormData(form({ label: "  Sick ", start_on: "2026-11-03", end_on: "", note: "" }));
    expect(result).toMatchObject({ changed: true, period: { label: "Sick", end_on: null, note: null } });
    expect(state.calls).toEqual([{ fn: "create_period", args: { p_label: "Sick", p_start_on: "2026-11-03", p_end_on: null, p_note: null } }]);
  });

  it("requires a signed-in user before any write", async () => {
    const { state } = signedIn();
    vi.mocked(requireCurrentUserId).mockRejectedValue(new Error("Sign in again before changing periods."));
    await expect(createPeriodFromFormData(form({ label: "Sick", start_on: "2026-11-03" }))).rejects.toThrow("Sign in again");
    await expect(deletePeriodFromFormData(form({ period_id: "x", expected_revision: "1" }))).rejects.toThrow("Sign in again");
    expect(state.calls).toEqual([]);
  });

  it("turns the cap error into the limit message and passes other errors on", async () => {
    signedIn({ createError: { code: "54000", message: "An account can hold at most 500 periods." } });
    await expect(createPeriodFromFormData(form({ label: "Sick", start_on: "2026-11-03" }))).rejects.toThrow(PERIOD_LIMIT_MESSAGE);
    signedIn({ createError: { code: "22023", message: "The period label is invalid." } });
    await expect(createPeriodFromFormData(form({ label: "Sick", start_on: "2026-11-03" }))).rejects.toMatchObject({ code: "22023" });
  });

  it("edits from the full editor form with the revision as text and browser line breaks", async () => {
    const { state } = signedIn({ rows: [row({ note: "Old" })] });
    const result = await updatePeriodFromFormData(form({
      period_id: row().id, expected_revision: "1", label: "Flu", start_on: "2026-11-02", end_on: "2026-11-09", note: "Fever\r\nRest",
    }));
    expect(result.period).toMatchObject({ label: "Flu", start_on: "2026-11-02", end_on: "2026-11-09", note: "Fever\nRest", revision: 2 });
    expect(state.calls[0]).toEqual({ fn: "update_period", args: {
      p_id: row().id, p_expected_revision: 1, p_label: "Flu", p_start_on: "2026-11-02", p_end_on: "2026-11-09", p_note: "Fever\nRest",
    } });
  });

  it("keeps the note when the edit form has no note field", async () => {
    const { state } = signedIn({ rows: [row({ note: "Old" })] });
    const result = await updatePeriodFromFormData(form({ period_id: row().id, expected_revision: "1", label: "Flu", start_on: "2026-11-02", end_on: "" }));
    expect(result.period).toMatchObject({ label: "Flu", note: "Old", revision: 2 });
    expect(state.calls[0]!.args).toMatchObject({ p_note: "Old" });
  });

  it("saves the note alone from the note field's form", async () => {
    const { state } = signedIn({ rows: [row({ note: "Old", revision: 3 })] });
    const result = await savePeriodNoteFromFormData(form({ period_id: row().id, expected_note: "Old", note: "Old\r\nRest", used_shortcut: "false" }));
    expect(result.period).toMatchObject({ note: "Old\nRest", revision: 4 });
    expect(state.calls).toEqual([{ fn: "update_period", args: {
      p_id: row().id, p_expected_revision: 3, p_label: row().label, p_start_on: row().start_on, p_end_on: row().end_on, p_note: "Old\nRest",
    } }]);
    await expect(savePeriodNoteFromFormData(form({ period_id: row().id, expected_note: "Old", note: "Other" }))).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("reports a conflict for a stale form and for another account's Period id", async () => {
    signedIn({ rows: [row({ revision: 2 }), row({ id: "50000000-0000-4000-8000-0000000000b0", user_id: "user-2" })] });
    await expect(updatePeriodFromFormData(form({ period_id: row().id, expected_revision: "1", label: "Flu", start_on: "2026-11-03" })))
      .rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    await expect(updatePeriodFromFormData(form({
      period_id: "50000000-0000-4000-8000-0000000000b0", expected_revision: "1", label: "Flu", start_on: "2026-11-03",
    }))).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
  });

  it("ends a Period on the profile's local date at the time of the write", async () => {
    // 03:30 UTC on November 11 is still November 10 in New York and already November 11 in Berlin.
    const now = Temporal.Instant.from("2026-11-11T03:30:00Z");
    const newYork = hosted({ rows: [row()], timezone: "America/New_York" });
    expect((await endPeriodForUser(newYork.supabase, "user-1", { id: row().id, expectedRevision: 1 }, { now })).period.end_on).toBe("2026-11-10");
    const berlin = hosted({ rows: [row()], timezone: "Europe/Berlin" });
    expect((await endPeriodForUser(berlin.supabase, "user-1", { id: row().id, expectedRevision: 1 }, { now })).period.end_on).toBe("2026-11-11");
    expect(await periodTodayForUser(hosted({ timezone: null }).supabase, "user-1", now)).toBe("2026-11-10");
  });

  it("applies the End today rule to the profile's date, not UTC", async () => {
    const now = Temporal.Instant.from("2026-11-11T03:30:00Z");
    const startsTomorrowLocally = hosted({ rows: [row({ start_on: "2026-11-11" })], timezone: "America/New_York" });
    await expect(endPeriodForUser(startsTomorrowLocally.supabase, "user-1", { id: row().id, expectedRevision: 1 }, { now }))
      .rejects.toThrow(PERIOD_MESSAGES.endNotStarted);
    expect(startsTomorrowLocally.state.calls).toEqual([]);
  });

  it("ends from a form with the current clock", async () => {
    const { state } = signedIn({ rows: [row({ start_on: "2020-01-01" })] });
    const result = await endPeriodFromFormData(form({ period_id: row().id, expected_revision: "1" }));
    expect(result.period.end_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.calls[0]?.args).toMatchObject({ p_label: "Sick", p_start_on: "2020-01-01", p_expected_revision: 1 });
  });

  it("deletes with the revision and reports a conflict when nothing was deleted", async () => {
    const { state } = signedIn({ rows: [row()] });
    await expect(deletePeriodFromFormData(form({ period_id: row().id, expected_revision: "2" }))).rejects.toThrow(PERIOD_CONFLICT_MESSAGE);
    await expect(deletePeriodFromFormData(form({ period_id: row().id, expected_revision: "1" }))).resolves.toEqual({ id: row().id });
    expect(state.rows).toEqual([]);
    expect(state.calls.at(-1)).toEqual({ fn: "delete_period", args: { p_id: row().id, p_expected_revision: 1 } });
  });

  it("lists the owner's Periods, and asks the database for the overlap when given a range", async () => {
    const rows = [
      row({ id: "a", start_on: "2026-10-01", end_on: "2026-10-05" }),
      row({ id: "b", start_on: "2026-11-03", end_on: null }),
      row({ id: "c", start_on: "2026-12-01", end_on: "2026-12-02" }),
      row({ id: "other", user_id: "user-2" }),
    ];
    const all = hosted({ rows });
    expect((await listPeriodsForUser(all.supabase, "user-1")).map((item) => item.id)).toEqual(["a", "b", "c"]);
    const ranged = hosted({ rows });
    expect((await listPeriodsForUser(ranged.supabase, "user-1", { from: "2026-11-01", to: "2026-11-30" })).map((item) => item.id)).toEqual(["b"]);
    expect(ranged.state.filters).toEqual(["eq:user_id", "lte:start_on:2026-11-30", "or:end_on.is.null,end_on.gte.2026-11-01"]);
  });

  it("pages the read", async () => {
    const many = Array.from({ length: 5 }, (_, index) => row({ id: `p-${index}` }));
    const { supabase } = hosted({ rows: many });
    const range = vi.fn(async (from: number, to: number) => ({ data: many.slice(from, to + 1), error: null }));
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order"]) builder[name] = () => builder;
    builder.range = range;
    Object.assign(supabase, { from: () => builder });
    expect(await listPeriods(supabase, "user-1")).toHaveLength(5);
    expect(range).toHaveBeenCalledWith(0, 999);
  });
});
