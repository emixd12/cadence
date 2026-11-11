import { describe, it, expect } from "vitest";
import { categorySnapshot, planCategoryChange } from "../packages/core/src/services/category.service";
const rows = [{ id: "a", name: "Home", description: null, sort_order: 0, updated_at: "2026-09-05T00:00:00Z" },
  { id: "b", name: "Work", description: "Office routines", sort_order: 1, updated_at: "2026-09-05T00:00:00Z" }];
function form(intent: string, values: Record<string, string> = {}) {
  const input = new FormData();
  for (const [key, value] of Object.entries({ intent, expected: categorySnapshot(rows), ...values })) input.set(key, value);
  return input;
}
describe("category management plans", () => {
  it("creates, renames, reorders, and deletes without mutating its snapshot", () => {
    expect(planCategoryChange(rows, form("create", { name: " Travel ", description: " Trips " }), "c", "now").categories[2]).toMatchObject({ id: "c", name: "Travel", description: "Trips" });
    expect(planCategoryChange(rows, form("update", { category_id: "b", name: "Office" }), "c", "now").categories[1]).toMatchObject({ id: "b", name: "Office", description: null });
    expect(planCategoryChange(rows, form("move", { category_id: "b", position: "0" }), "c", "now").categories.map((row) => row.id)).toEqual(["b", "a"]);
    expect(planCategoryChange(rows, form("delete", { category_id: "a", confirm_delete: "yes" }), "c", "now")).toMatchObject({ deletedId: "a", categories: [{ id: "b", sort_order: 0 }] });
    expect(rows[0].name).toBe("Home");
  });
  it("rejects stale drafts, duplicate or invalid names, oversized descriptions, and unconfirmed deletion", () => {
    const nonText = form("create", { name: "Valid" });
    nonText.set("description", new Blob(["file content"]));
    expect(() => planCategoryChange(rows, nonText, "c", "now")).toThrow(/plain text/);
    for (const input of [form("create", { name: "home" }), form("create", { name: "" }), form("create", { name: "x".repeat(121) }),
      form("create", { name: "Good", description: "x".repeat(2001) }), form("create", { name: "Good", expected: "[]" }),
      form("delete", { category_id: "a" }), form("update", { category_id: "foreign", name: "X" })]) {
      expect(() => planCategoryChange(rows, input, "c", "now")).toThrow();
    }
  });
  it("moves a category to a position and renumbers only the rows that moved", () => {
    const four = ["a", "b", "c", "d"].map((id, index) => ({ id, name: id.toUpperCase(), description: null, sort_order: index, updated_at: "then" }));
    const move = (id: string, position: string, expected = categorySnapshot(four)) => {
      const input = new FormData();
      for (const [key, value] of Object.entries({ intent: "move", category_id: id, position, expected })) input.set(key, value);
      return planCategoryChange(four, input, "new", "now");
    };
    expect(move("d", "1")).toEqual({ deletedId: null, categories: [
      { id: "a", name: "A", description: null, sort_order: 0, updated_at: "then" },
      { id: "d", name: "D", description: null, sort_order: 1, updated_at: "now" },
      { id: "b", name: "B", description: null, sort_order: 2, updated_at: "now" },
      { id: "c", name: "C", description: null, sort_order: 3, updated_at: "now" },
    ] });
    expect(move("a", "3").categories.map((row) => row.id)).toEqual(["b", "c", "d", "a"]);
    expect(move("b", "1").categories.every((row) => row.updated_at === "then")).toBe(true);
    for (const position of ["4", "-1", "1.5", "", "one"]) expect(() => move("a", position)).toThrow(/position/);
    expect(() => move("missing", "0")).toThrow(/existing category/);
    const stale = categorySnapshot(four.map((row) => row.id === "c" ? { ...row, name: "Renamed" } : row));
    expect(() => move("d", "0", stale)).toThrow(/Categories changed/);
    expect(four.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("no longer accepts the retired Move up and Move down intents", () => {
    expect(() => planCategoryChange(rows, form("up", { category_id: "b" }), "c", "now")).toThrow(/category action/);
  });
});
