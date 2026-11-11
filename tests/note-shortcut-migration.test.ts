import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260908003245_add_note_shortcut_states.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("Ticket 127 Note shortcut migration", () => {
  it("creates an owner-scoped constrained state table with RLS", () => {
    expect(migration).toContain("create table public.note_shortcut_states");
    expect(migration).toContain("primary key (user_id, id)");
    expect(migration).toContain("foreign key (user_id, behavior_id)");
    expect(migration).toContain("alter table public.note_shortcut_states enable row level security");
    expect(migration).toContain("grant select on table public.note_shortcut_states to authenticated");
    expect(migration).not.toContain("grant insert on table public.note_shortcut_states to authenticated");
    expect(migration).not.toContain("grant update on table public.note_shortcut_states to authenticated");
  });

  it("keeps reads under RLS and protects both atomic mutation boundaries", () => {
    expect(migration).toMatch(/create function public\.read_note_shortcut_context[\s\S]*?security invoker/);
    expect(migration).toMatch(/create function public\.commit_note_shortcut_state[\s\S]*?security definer[\s\S]*?auth\.uid\(\)/);
    expect(migration).toMatch(/create function public\.update_occurrence_note_with_shortcut[\s\S]*?security definer[\s\S]*?auth\.uid\(\)/);
    expect(migration).toContain("this shortcut changed elsewhere. refresh and try again.");
    expect(migration).toContain("a note shortcut source collection exceeds 100,000 rows.");
    expect(migration).toContain("the note shortcut context exceeds 64 mib.");
  });

  it("keeps schema version one while adding the closed sync entity", () => {
    expect(migration).toContain("'note_shortcut_state'");
    expect(migration).toContain("from public.note_shortcut_states r");
    expect(migration).not.toContain("'schemaversion', 2");
    expect(migration).toContain("on conflict (user_id, id) do update set");
  });
});

describe("Ticket 305 Note shortcuts on by default", () => {
  const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
  const original = readFileSync(
    new URL("../supabase/migrations/20260908003245_add_note_shortcut_states.sql", import.meta.url),
    "utf8",
  );
  const gate = read("20261110153050_allow_default_on_note_shortcuts.sql");
  const flip = read("20261110170000_turn_on_note_shortcuts_once.sql");
  const desktop = readFileSync(
    new URL("../apps/desktop/src-tauri/migrations/0022_note_shortcuts_on_by_default.sql", import.meta.url),
    "utf8",
  );
  const statements = (sql: string) => sql.replace(/--.*$/gm, "").split(";").map((part) => part.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);

  it("changes only the commit gate: absent global state means on and the Behavior flag no longer gates", () => {
    const body = (sql: string) => sql.slice(sql.indexOf("function public.commit_note_shortcut_state("), sql.indexOf("$$;", sql.indexOf("function public.commit_note_shortcut_state(")));
    const gateOf = (sql: string) => body(sql).replace(/ {2}(?:-- Ticket 305[^\n]*\n {2}--[^\n]*\n {2})?if require_enabled[\s\S]*?end if;\n/g, "");
    expect(gate).toContain("create or replace function public.commit_note_shortcut_state(");
    expect(gate).toContain("security definer");
    expect(gate).toContain("coalesce((current_context #>> '{globalState,enabled}')::boolean, true) is not true");
    expect(gate).not.toContain("'{state,enabled}'");
    const outside = gate.slice(0, gate.indexOf("create or replace")) + gate.slice(gate.indexOf("$$;") + 3);
    expect(statements(outside)).toEqual([
      "begin",
      "revoke all on function public.commit_note_shortcut_state(jsonb, jsonb, boolean) from public, anon, service_role",
      "grant execute on function public.commit_note_shortcut_state(jsonb, jsonb, boolean) to authenticated",
      "commit",
    ]);
    expect(gateOf(gate)).toBe(gateOf(original));
  });

  it("turns stored global off switches on once without touching revision, time, or Behavior rows", () => {
    const expected = ["begin", "update public.note_shortcut_states set enabled = true where id = 'global' and enabled = false", "commit"];
    expect(statements(flip)).toEqual(expected);
    expect(statements(desktop)).toEqual(["update note_shortcut_states set enabled = 1 where id = 'global' and enabled = 0"]);
  });
});
