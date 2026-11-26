import { beforeEach, describe, expect, it, vi } from "vitest";

import { noticeText } from "@cadence/core/notices";
import { PERIOD_MESSAGES } from "@cadence/core/resolvers/period.resolver";
import { PERIOD_CONFLICT_MESSAGE, PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";
import type { PeriodActionState } from "@cadence/core/types/period";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUserId: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

type Row = {
  id: string; user_id: string; label: string; start_on: string; end_on: string | null; note: string | null;
  revision: number; created_at: string; updated_at: string;
};
type Args = Record<string, string | number | null>;

const ID = "50000000-0000-4000-8000-000000000001";
const IDLE: PeriodActionState = { status: "idle", message: "" };

const row = (overrides: Partial<Row> = {}): Row => ({
  id: ID, user_id: "user-1", label: "Sick", start_on: "2026-11-03", end_on: null, note: null, revision: 1,
  created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-03T12:00:00Z", ...overrides,
});

// Stands in for the hosted project: the periods table, the profile timezone and the
// three functions with their compare-and-set on revision.
function hosted(input: { rows?: Row[]; createError?: { code: string; message: string } } = {}) {
  const state = { rows: (input.rows ?? []).map((item) => ({ ...item })), calls: [] as Array<{ fn: string; args: Args }> };
  const table = (name: string) => {
    const filters: Array<(item: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: keyof Row, value: string) => { filters.push((item) => item[column] === value); return builder; },
      maybeSingle: async () => name === "profiles"
        ? { data: { email: "a@example.invalid", timezone: "America/New_York" }, error: null }
        : { data: state.rows.find((item) => filters.every((test) => test(item))) ?? null, error: null },
    };
    return builder;
  };
  const rpc = (fn: string, args: Args) => {
    const run = async () => {
      state.calls.push({ fn, args });
      if (fn === "create_period") {
        if (input.createError) return { data: null, error: input.createError };
        const created = row({ id: "50000000-0000-4000-8000-000000000002", label: String(args.p_label), start_on: String(args.p_start_on),
          end_on: args.p_end_on as string | null, note: args.p_note as string | null });
        state.rows.push(created);
        return { data: created, error: null };
      }
      const current = state.rows.find((item) => item.id === args.p_id);
      if (!current || current.revision !== args.p_expected_revision) return { data: null, error: null };
      if (fn === "delete_period") {
        state.rows = state.rows.filter((item) => item !== current);
        return { data: current.id, error: null };
      }
      Object.assign(current, { label: args.p_label, start_on: args.p_start_on, end_on: args.p_end_on, note: args.p_note,
        revision: current.revision + 1 });
      return { data: { ...current }, error: null };
    };
    return { maybeSingle: run, then: (resolve: (value: unknown) => unknown) => run().then(resolve) };
  };
  return { state, supabase: { from: table, rpc } };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

async function actions() {
  return import("../app/(app)/timeline/actions");
}

describe("Period Server Actions (Ticket 369)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUserId).mockResolvedValue("user-1");
  });

  it("adds a Period, names the saved notice and revalidates Timeline and Behaviors", async () => {
    const { state, supabase } = hosted();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { savePeriodAction } = await actions();

    const result = await savePeriodAction(IDLE, form({ label: "  Sick ", start_on: "2026-11-03", end_on: "", note: "" }));

    expect(result).toEqual({ status: "success", noticeId: "period.saved", message: "Period saved." });
    expect(state.calls).toEqual([{ fn: "create_period", args: { p_label: "Sick", p_start_on: "2026-11-03", p_end_on: null, p_note: null } }]);
    expect(mocks.revalidatePath.mock.calls).toEqual([["/timeline"], ["/behaviors"]]);
  });

  it("edits the named Period with the revision the form read", async () => {
    const { state, supabase } = hosted({ rows: [row()] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { savePeriodAction } = await actions();

    const result = await savePeriodAction(IDLE, form({
      period_id: ID, expected_revision: "1", label: "Flu", start_on: "2026-11-03", end_on: "2026-11-09", note: "Stayed home",
    }));

    expect(result).toMatchObject({ status: "success", noticeId: "period.saved" });
    expect(state.calls[0]).toEqual({ fn: "update_period", args: {
      p_id: ID, p_expected_revision: 1, p_label: "Flu", p_start_on: "2026-11-03", p_end_on: "2026-11-09", p_note: "Stayed home",
    } });
    expect(state.rows[0]).toMatchObject({ label: "Flu", end_on: "2026-11-09", revision: 2 });
  });

  it("saves the note field on its own and answers with the next revision", async () => {
    const { state, supabase } = hosted({ rows: [row()] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { savePeriodNoteAction } = await actions();

    const saved = await savePeriodNoteAction(IDLE, form({ period_id: ID, expected_note: row().note ?? "", note: "Fever" }));
    expect(saved).toEqual({ status: "success", message: "", revision: 2 });
    expect(state.rows[0]).toMatchObject({ label: row().label, note: "Fever", revision: 2 });
    expect(mocks.revalidatePath.mock.calls).toEqual([["/timeline"], ["/behaviors"]]);

    const stale = await savePeriodNoteAction(IDLE, form({ period_id: ID, expected_note: "Something else", note: "Rest" }));
    expect(stale).toEqual({ status: "error", message: PERIOD_CONFLICT_MESSAGE });
    const long = await savePeriodNoteAction(IDLE, form({ period_id: ID, expected_note: "Fever", note: "x".repeat(2001) }));
    expect(long).toEqual({ status: "error", message: PERIOD_MESSAGES.noteTooLong });
  });

  it("returns the service's own sentence for a broken rule and writes nothing", async () => {
    const { state, supabase } = hosted();
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { savePeriodAction } = await actions();

    await expect(savePeriodAction(IDLE, form({ label: " ", start_on: "2026-11-03", end_on: "", note: "" })))
      .resolves.toEqual({ status: "error", message: PERIOD_MESSAGES.labelRequired });
    await expect(savePeriodAction(IDLE, form({ label: "Sick", start_on: "2026-11-09", end_on: "2026-11-03", note: "" })))
      .resolves.toEqual({ status: "error", message: PERIOD_MESSAGES.endBeforeStart });
    expect(state.calls).toEqual([]);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("names the conflict notice for a stale save, End today and Remove", async () => {
    const { state, supabase } = hosted({ rows: [row({ revision: 4 })] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { savePeriodAction, endPeriodAction, deletePeriodAction } = await actions();
    const conflict = { status: "error", noticeId: "period.conflict", message: PERIOD_CONFLICT_MESSAGE };

    await expect(savePeriodAction(IDLE, form({ period_id: ID, expected_revision: "3", label: "Flu", start_on: "2026-11-03", end_on: "", note: "" })))
      .resolves.toEqual(conflict);
    await expect(endPeriodAction(IDLE, form({ period_id: ID, expected_revision: "3" }))).resolves.toEqual(conflict);
    await expect(deletePeriodAction(IDLE, form({ period_id: ID, expected_revision: "3" }))).resolves.toEqual(conflict);
    expect(state.rows[0]).toMatchObject({ label: "Sick", revision: 4 });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the conflict notice's words the same as the service's message", () => {
    expect(noticeText("period.conflict")).toBe(PERIOD_CONFLICT_MESSAGE);
  });

  it("ends a Period today in the account's timezone", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-10T03:30:00Z"), toFake: ["Date"] });
    try {
      const { state, supabase } = hosted({ rows: [row()] });
      vi.mocked(createClient).mockResolvedValue(supabase as never);
      const { endPeriodAction } = await actions();

      const result = await endPeriodAction(IDLE, form({ period_id: ID, expected_revision: "1" }));

      expect(result).toEqual({ status: "success", noticeId: "period.ended", message: "Period ended today." });
      // 03:30 UTC on November 10 is still November 9 in New York.
      expect(state.rows[0]).toMatchObject({ end_on: "2026-11-09", label: "Sick", revision: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses End today for a Period that has already ended", async () => {
    const { supabase } = hosted({ rows: [row({ end_on: "2026-11-04" })] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { endPeriodAction } = await actions();

    await expect(endPeriodAction(IDLE, form({ period_id: ID, expected_revision: "1" })))
      .resolves.toEqual({ status: "error", message: PERIOD_MESSAGES.endAlreadyEnded });
  });

  it("removes a Period", async () => {
    const { state, supabase } = hosted({ rows: [row()] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { deletePeriodAction } = await actions();

    const result = await deletePeriodAction(IDLE, form({ period_id: ID, expected_revision: "1" }));

    expect(result).toEqual({ status: "success", noticeId: "period.removed", message: "Period removed." });
    expect(state.rows).toEqual([]);
    expect(mocks.revalidatePath.mock.calls).toEqual([["/timeline"], ["/behaviors"]]);
  });

  it("shows the account limit and the sign-in sentence as written, and hides provider text", async () => {
    const { savePeriodAction } = await actions();
    const fields = { label: "Sick", start_on: "2026-11-03", end_on: "", note: "" };

    vi.mocked(createClient).mockResolvedValue(hosted({ createError: { code: "54000", message: "periods_account_cap" } }).supabase as never);
    await expect(savePeriodAction(IDLE, form(fields))).resolves.toEqual({ status: "error", message: PERIOD_LIMIT_MESSAGE });

    vi.mocked(createClient).mockResolvedValue(hosted({ createError: { code: "XX000", message: "relation internals" } }).supabase as never);
    await expect(savePeriodAction(IDLE, form(fields))).resolves.toEqual({ status: "error", message: "Unable to save this period." });

    vi.mocked(requireCurrentUserId).mockRejectedValue(new Error("Sign in again before changing periods."));
    await expect(savePeriodAction(IDLE, form(fields))).resolves.toEqual({ status: "error", message: "Sign in again before changing periods." });
  });
});
