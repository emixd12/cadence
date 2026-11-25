import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NEGATIVE_FIXTURE,
  SelectParseError,
  buildRelationshipGraph,
  checkFiles,
  checkSelect,
  loadGraph,
  parseRelationships,
  parseSelect,
  type EmbedItem,
  type SelectItem,
} from "../scripts/check-postgrest-embeds.mjs";

function relationship(fk: string, columns: string[], referenced: string, referencedColumns: string[]): string {
  return `{
            foreignKeyName: "${fk}"
            columns: [${columns.map((column) => `"${column}"`).join(", ")}]
            isOneToOne: false
            referencedRelation: "${referenced}"
            referencedColumns: [${referencedColumns.map((column) => `"${column}"`).join(", ")}]
          },`;
}

function table(name: string, relationships: string[]): string {
  return `      ${name}: {
        Row: { id: string }
        Insert: { id?: string }
        Update: { id?: string }
        Relationships: [
          ${relationships.join("\n          ")}
        ]
      }`;
}

// A small schema with the shapes the real one has: two keys in one direction
// (deliveries -> occurrences), keys in both directions (events <-> behaviors),
// a self-reference (behaviors.parent) and one plain key (occurrences -> behaviors).
const TYPES = `export type Json = string
export type Database = {
  public: {
    Tables: {
${table("behaviors", [
    relationship("behaviors_current_event_fkey", ["user_id", "id", "current_event_id"], "events", ["user_id", "behavior_id", "id"]),
    relationship("behaviors_parent_fkey", ["parent_id"], "behaviors", ["id"]),
  ])}
${table("events", [relationship("events_behavior_owner_fkey", ["user_id", "behavior_id"], "behaviors", ["user_id", "id"])])}
${table("occurrences", [relationship("occurrences_behavior_id_fkey", ["behavior_id"], "behaviors", ["id"])])}
${table("deliveries", [
    relationship("deliveries_occurrence_id_fkey", ["occurrence_id"], "occurrences", ["id"]),
    relationship("deliveries_occurrence_owner_fkey", ["user_id", "occurrence_id"], "occurrences", ["user_id", "id"]),
  ])}
${table("tags", [])}
    }
    Views: {
      occurrence_view: {
        Row: { id: string }
        Relationships: [
          ${relationship("occurrences_behavior_id_fkey", ["behavior_id"], "behaviors", ["id"])}
        ]
      }
    }
    Functions: {}
  }
}
`;

const graph = buildRelationshipGraph(parseRelationships(TYPES));

function embeds(items: SelectItem[]): EmbedItem[] {
  return items.flatMap((item) => item.kind === "embed" ? [item, ...embeds(item.children)] : []);
}

describe("parseSelect", () => {
  it("parses columns, star, aliases, casts and JSON arrows", () => {
    expect(parseSelect("*, id, label:name, total::int, data->a->>b::text, renamed:data->>c")).toEqual([
      { kind: "star" },
      { kind: "field", alias: null, name: "id", cast: null, json: null },
      { kind: "field", alias: "label", name: "name", cast: null, json: null },
      { kind: "field", alias: null, name: "total", cast: "int", json: null },
      { kind: "field", alias: null, name: "data", cast: "text", json: "->a->>b" },
      { kind: "field", alias: "renamed", name: "data", cast: null, json: "->>c" },
    ]);
  });

  it("separates foreign key hints from the inner and left modifiers", () => {
    const [plain, inner, hinted, both, left] = embeds(parseSelect(
      "a(id), b!inner(id), c!c_fkey(id), d!d_fkey!inner(id), e!left(id)",
    ));
    expect([plain.hint, plain.modifiers]).toEqual([null, []]);
    expect([inner.hint, inner.modifiers]).toEqual([null, ["inner"]]);
    expect([hinted.hint, hinted.modifiers]).toEqual(["c_fkey", []]);
    expect([both.hint, both.modifiers]).toEqual(["d_fkey", ["inner"]]);
    expect([left.hint, left.modifiers]).toEqual([null, ["left"]]);
  });

  it("parses aliased, nested and spread embeds with whitespace and newlines", () => {
    const text = `*,
      category:categories!behaviors_category_id_fkey(id, name),
      schedules:behavior_schedules!owner_fkey(*, slots:behavior_schedule_slots!slot_fkey(*)),
      ...profiles(timezone)`;
    const items = parseSelect(text);
    const [category, schedules, slots, profile] = embeds(items);
    expect(category).toMatchObject({ alias: "category", name: "categories", hint: "behaviors_category_id_fkey", spread: false });
    expect(schedules).toMatchObject({ alias: "schedules", name: "behavior_schedules", hint: "owner_fkey" });
    expect(schedules.children[1]).toBe(slots);
    expect(slots).toMatchObject({ alias: "slots", name: "behavior_schedule_slots", hint: "slot_fkey" });
    expect(profile).toMatchObject({ alias: null, name: "profiles", spread: true, hint: null });
    expect(text.slice(category.start, category.end)).toBe("category:categories!behaviors_category_id_fkey(id, name)");
    expect(profile.raw).toBe("...profiles(timezone)");
  });

  it("treats aggregates as fields, not embeds", () => {
    const items = parseSelect("count(), amount.sum(), total:amount.avg()::int, rows:occurrences(count)");
    expect(items.map((item) => item.kind)).toEqual(["aggregate", "aggregate", "aggregate", "embed"]);
  });

  it("accepts an empty embed list and quoted names", () => {
    const [embed] = embeds(parseSelect("id, occurrences!inner(), \"odd name\""));
    expect(embed.children).toEqual([]);
    expect(parseSelect("\"odd, name\"")).toEqual([{ kind: "field", alias: null, name: "odd, name", cast: null, json: null }]);
  });

  it("rejects malformed text", () => {
    for (const text of ["a(id", "a)", "a,,b", "a!(id)", "(id)"]) {
      expect(() => parseSelect(text), text).toThrow(SelectParseError);
    }
  });
});

describe("relationship graph", () => {
  it("reads tables, views and every foreign key", () => {
    const data = parseRelationships(TYPES);
    expect([...data.relations]).toEqual([
      ["behaviors", "table"], ["events", "table"], ["occurrences", "table"], ["deliveries", "table"], ["tags", "table"],
      ["occurrence_view", "view"],
    ]);
    expect(data.foreignKeys).toHaveLength(7);
  });

  it("finds keys between a pair in either direction", () => {
    expect(graph.candidates("deliveries", "occurrences").map((c) => [c.foreignKeyName, c.direction])).toEqual([
      ["deliveries_occurrence_id_fkey", "many-to-one"],
      ["deliveries_occurrence_owner_fkey", "many-to-one"],
    ]);
    expect(graph.candidates("occurrences", "deliveries").map((c) => c.direction)).toEqual(["one-to-many", "one-to-many"]);
    expect(graph.candidates("behaviors", "events").map((c) => c.foreignKeyName).sort()).toEqual([
      "behaviors_current_event_fkey", "events_behavior_owner_fkey",
    ]);
    expect(graph.candidates("behaviors", "behaviors").map((c) => c.direction)).toEqual(["many-to-one", "one-to-many"]);
    expect(graph.candidates("occurrences", "behaviors")).toHaveLength(1);
    expect(graph.candidates("tags", "behaviors")).toEqual([]);
  });

  it("lists ambiguous pairs once each", () => {
    expect(graph.ambiguousPairs().map((pair) => `${pair.a}-${pair.b}`)).toEqual([
      "behaviors-behaviors", "behaviors-events", "deliveries-occurrences",
    ]);
  });

  it("reads the real generated types", () => {
    const real = loadGraph(process.cwd());
    const pairs = real.ambiguousPairs().map((pair) => `${pair.a}-${pair.b}`);
    expect(pairs).toContain("occurrences-reminder_deliveries");
    expect(pairs).toContain("behavior_configuration_events-behaviors");
  });
});

describe("checkSelect", () => {
  function problems(text: string, root: string) {
    return checkSelect(parseSelect(text), root, graph).issues.map((issue) => `${issue.parent}>${issue.child}`);
  }

  it("fails an ambiguous embed even with the inner modifier", () => {
    const { issues } = checkSelect(parseSelect("id, occurrences!inner(local_date)"), "deliveries", graph);
    expect(issues).toHaveLength(1);
    expect(issues[0].candidates).toEqual(["deliveries_occurrence_id_fkey", "deliveries_occurrence_owner_fkey"]);
    expect(issues[0].corrections).toEqual([
      "occurrences!deliveries_occurrence_id_fkey!inner(local_date)",
      "occurrences!deliveries_occurrence_owner_fkey!inner(local_date)",
    ]);
  });

  it("passes a key-name hint or a column hint that picks one key", () => {
    expect(problems("id, occurrences!deliveries_occurrence_owner_fkey!inner(local_date)", "deliveries")).toEqual([]);
    expect(problems("id, events!current_event_id(id)", "behaviors")).toEqual([]);
  });

  it("fails a hint that matches no key or more than one", () => {
    expect(problems("id, occurrences!missing_fkey(id)", "deliveries")).toEqual(["deliveries>occurrences"]);
    expect(problems("id, occurrences!occurrence_id(id)", "deliveries")).toEqual(["deliveries>occurrences"]);
    expect(problems("id, behaviors!wrong_fkey(id)", "occurrences")).toEqual(["occurrences>behaviors"]);
  });

  it("passes an embed with a single key and no hint", () => {
    expect(problems("id, behavior:behaviors(timezone)", "occurrences")).toEqual([]);
  });

  it("fails keys in both directions and a self-reference without a hint", () => {
    expect(problems("id, events(id)", "behaviors")).toEqual(["behaviors>events"]);
    expect(problems("id, parent:behaviors(id)", "behaviors")).toEqual(["behaviors>behaviors"]);
    expect(problems("id, parent:behaviors!behaviors_parent_fkey(id)", "behaviors")).toEqual([]);
  });

  it("checks a nested embed against the embedded table, not the root table", () => {
    // occurrences has one key to behaviors; deliveries has two to occurrences.
    expect(problems("id, occurrences!deliveries_occurrence_id_fkey(id, behaviors(id))", "deliveries")).toEqual([]);
    expect(problems("id, behaviors(id, occurrences(id, deliveries(id)))", "occurrences")).toEqual(["occurrences>deliveries"]);
  });

  it("checks spread embeds", () => {
    expect(problems("id, ...occurrences(local_date)", "deliveries")).toEqual(["deliveries>occurrences"]);
  });

  it("skips embeds it cannot model instead of failing", () => {
    const result = checkSelect(parseSelect("id, tags(id), unknown_thing(id, occurrences(id))"), "behaviors", graph);
    expect(result.issues).toEqual([]);
    expect(result.skipped.map((skip) => skip.embed.name)).toEqual(["tags", "unknown_thing", "occurrences"]);
  });
});

describe("checkFiles", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function repo(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-postgrest-embeds-"));
    roots.push(root);
    for (const [file, text] of Object.entries({ "lib/db/database.types.ts": TYPES, ...files })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  it("resolves constants, imports, concatenation and query variables", () => {
    const root = repo({
      "lib/db/selects.ts": `export const DELIVERY_SELECT = "id, " + \`occurrences!inner(local_date)\`;`,
      "lib/db/a.repo.ts": `import { DELIVERY_SELECT as SELECT } from "@/lib/db/selects";
const LOCAL = "id, behaviors(timezone)";
export async function a(client) {
  let query = client.from("deliveries").select(SELECT);
  const other = client.from("occurrences");
  await other.eq("id", 1).select(LOCAL);
  function scoped() { const LOCAL = "id, occurrences(id)"; return client.from("deliveries").select(LOCAL); }
  return [query, scoped];
}`,
    });
    const result = checkFiles(root, [path.join(root, "lib/db/a.repo.ts")]);
    expect(result.analysed).toBe(3);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toContain("lib/db/a.repo.ts:4 (select text from SELECT, ");
    expect(result.failures[0]).toContain("occurrences!deliveries_occurrence_owner_fkey!inner(local_date)");
    // The inner LOCAL shadows the file constant: the scoped one is the ambiguous select.
    expect(result.failures[1]).toContain("lib/db/a.repo.ts:7 (select text from LOCAL, lib/db/a.repo.ts:7)");
  });

  it("counts calls it cannot resolve as not analysed and never fails on them", () => {
    const root = repo({
      "lib/db/b.repo.ts": `export async function b(client, select, table) {
  await client.from(table).select("id, occurrences(id)");
  await client.from("deliveries").select(select);
  await client.rpc("fn").select("id, occurrences(id)");
  await client.from(table).select("id, name");
}`,
    });
    const result = checkFiles(root, [path.join(root, "lib/db/b.repo.ts")]);
    expect(result.failures).toEqual([]);
    expect(result.analysed).toBe(1);
    expect([...result.notAnalysed.keys()]).toEqual([
      ".from() table name is not static",
      "select text is not a static string",
      "embed on an .rpc() result",
    ]);
  });
});

describe("check-postgrest-embeds command", () => {
  it("fails on the pre-fix coach-signals fixture and names the fix", () => {
    const run = spawnSync(process.execPath, ["scripts/check-postgrest-embeds.mjs", NEGATIVE_FIXTURE], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("embed of occurrences under reminder_deliveries");
    expect(run.stderr).toContain("occurrences!reminder_deliveries_occurrence_owner_fkey!inner(local_date)");
    expect(run.stderr).not.toContain("occurrence_time_sessions");
  });
});
