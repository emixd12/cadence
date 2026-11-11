import { beforeEach, describe, expect, it, vi } from "vitest";

import { DAY_NOTE_CONFLICT_MESSAGE } from "@cadence/core/services/day-note.service";

import { requireCurrentUserId } from "@/lib/auth/current-user";
import { saveDayNoteFromFormData } from "@/lib/services/day-note.service";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUserId: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/note-shortcut.service", () => ({ matchRepeatedNotesAfterNoteSave: vi.fn() }));

type RpcArgs = { target_local_date: string; expected_note: string | null; next_note: string | null; used_shortcut?: boolean };

// Compares like the hosted save_day_note and save_day_note_with_shortcut RPCs:
// no row when the stored note is distinct from expected_note.
function hostedDayNotes(saved: string | null) {
  const state = { saved, calls: [] as Array<{ fn: string; args: RpcArgs }> };
  const supabase = {
    rpc: (fn: string, args: RpcArgs) => ({
      maybeSingle: async () => {
        state.calls.push({ fn, args });
        if (args.expected_note !== state.saved) return { data: null, error: null };
        state.saved = args.next_note;
        return {
          data: {
            id: "40000000-0000-4000-8000-000000000001", user_id: "user-1", local_date: args.target_local_date,
            note: args.next_note, revision: 2, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-11T00:00:00Z",
          },
          error: null,
        };
      },
    }),
  };
  return { state, supabase };
}

// A browser's multipart form submission sends textarea and hidden-field line breaks as CRLF.
function browserForm(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value.replace(/\n/g, "\r\n"));
  return formData;
}

describe("saveDayNoteFromFormData with browser line breaks (Ticket 292, defect D3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUserId).mockResolvedValue("user-1");
  });

  it("edits a saved multi-line day note", async () => {
    const { state, supabase } = hostedDayNotes("line one\nline two");
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await saveDayNoteFromFormData(browserForm({
      local_date: "2026-11-10", expected_note: "line one\nline two", note: "line one\nline three",
    }));

    expect(result).toMatchObject({ note: "line one\nline three", changed: true });
    expect(state.calls[0]).toMatchObject({ fn: "save_day_note", args: { expected_note: "line one\nline two" } });
  });

  it("clears a sync-merged day note", async () => {
    const { state, supabase } = hostedDayNotes("From the Mac\n\nFrom the web");
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await saveDayNoteFromFormData(browserForm({
      local_date: "2026-11-10", expected_note: "From the Mac\n\nFrom the web", note: "",
    }));

    expect(result).toMatchObject({ note: null, changed: true });
    expect(state.saved).toBeNull();
  });

  it("edits a multi-line day note through the shortcut save", async () => {
    const { state, supabase } = hostedDayNotes("line one\nline two");
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await saveDayNoteFromFormData(browserForm({
      local_date: "2026-11-10", expected_note: "line one\nline two", note: "Rest day", used_shortcut: "true",
    }));

    expect(state.calls[0]).toMatchObject({ fn: "save_day_note_with_shortcut", args: { used_shortcut: true } });
    expect(state.saved).toBe("Rest day");
  });

  it("still reports a conflict when the day note changed elsewhere", async () => {
    const { state, supabase } = hostedDayNotes("line one\nline two, edited on the Mac");
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await expect(saveDayNoteFromFormData(browserForm({
      local_date: "2026-11-10", expected_note: "line one\nline two", note: "New",
    }))).rejects.toThrow(DAY_NOTE_CONFLICT_MESSAGE);
    expect(state.saved).toBe("line one\nline two, edited on the Mac");
  });
});
