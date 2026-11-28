import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Audit fix 8 (D33): the flag's comment and the operations doc name every migration the
// alongside feature needs, and say the account sync one must precede the Ticket 363 deploy.

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const ALONGSIDE_MIGRATIONS = ["20261125140000", "20261125150000", "20261125180000", "20261125190000", "20261126200000", "20261126210000", "20261126220000", "20261126230000", "20261126240000", "20261126250000", "20261126260000"];

describe("alongside flag migrations", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));

  it("covers every alongside or Where-guess migration in the repository", () => {
    const named = migrations.filter((file) => /alongside|where_guess/.test(file)).map((file) => file.slice(0, 14));
    expect(named.filter((version) => !ALONGSIDE_MIGRATIONS.includes(version))).toEqual([]);
    for (const version of ALONGSIDE_MIGRATIONS) expect(migrations.some((file) => file.startsWith(`${version}_`))).toBe(true);
  });

  it.each(["lib/services/alongside-flag.ts", "docs/OPERATIONS.md", ".env.example"])("%s names every migration and the deploy order", (file) => {
    const text = read(file);
    for (const version of ALONGSIDE_MIGRATIONS) expect(text).toContain(version);
    expect(text).toMatch(/20261126220000[\s\S]{0,200}before the Ticket 363 code deploys/);
    expect(text).toMatch(/20261126240000[\s\S]{0,200}before the (advice )?card[\s\S]{0,60}activated/);
  });
});
