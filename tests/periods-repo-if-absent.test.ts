import { describe, expect, it } from "vitest";

import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { createPeriodIfAbsent, createPeriodStore } from "@/lib/db/periods.repo";

/** Ticket 373: the web adapter for `public.create_period_if_absent`. */

const ROW = {
  id: "50000000-0000-4000-8000-000000000001", user_id: "user-1", label: "Sick", start_on: "2026-11-03", end_on: null,
  note: null, revision: 1, created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-03T12:00:00Z",
};

function client(result: { data: unknown; error: { code: string; message: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const supabase = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { maybeSingle: async () => result };
    },
  } as unknown as AppSupabaseClient;
  return { supabase, calls };
}

const INPUT = { label: "Sick", startOn: "2026-11-03", endOn: null, note: "Flu" };

describe("createPeriodIfAbsent on web", () => {
  it("calls the function and separates the Period from the created flag", async () => {
    const { supabase, calls } = client({ data: { ...ROW, created: true }, error: null });
    expect(await createPeriodIfAbsent(supabase, INPUT)).toEqual({ period: ROW, created: true });
    expect(calls).toEqual([{ fn: "create_period_if_absent", args: { p_label: "Sick", p_start_on: "2026-11-03", p_end_on: null, p_note: "Flu" } }]);
  });

  it("reports an existing Period as not created, through the store", async () => {
    const { supabase } = client({ data: { ...ROW, note: "Stored", created: false }, error: null });
    expect(await createPeriodStore(supabase, "user-1").createPeriodIfAbsent!(INPUT)).toEqual({ period: { ...ROW, note: "Stored" }, created: false });
  });

  it("turns the cap error into the limit message and passes other errors on", async () => {
    await expect(createPeriodIfAbsent(client({ data: null, error: { code: "54000", message: "cap" } }).supabase, INPUT)).rejects.toThrow(PERIOD_LIMIT_MESSAGE);
    await expect(createPeriodIfAbsent(client({ data: null, error: { code: "22023", message: "bad" } }).supabase, INPUT)).rejects.toMatchObject({ code: "22023" });
  });

  it("refuses an answer without a row or without the created flag", async () => {
    await expect(createPeriodIfAbsent(client({ data: null, error: null }).supabase, INPUT)).rejects.toThrow("The period was not saved.");
    await expect(createPeriodIfAbsent(client({ data: ROW, error: null }).supabase, INPUT)).rejects.toThrow("The period was not saved.");
  });
});
