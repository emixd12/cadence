import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

describe("desktop Vite public auth configuration", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cadence-desktop-vite-auth-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("embeds direct public values and leaves an unconfigured production build disabled", () => {
    const url = "https://synthetic-release.supabase.co";
    const key = "sb_publishable_synthetic_release";
    const configured = build(path.join(directory, "configured"), { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key });
    expect(configured).toContain(url);
    expect(configured).toContain(key);

    const unconfigured = build(path.join(directory, "unconfigured"), {});
    expect(unconfigured).not.toContain(url);
    expect(unconfigured).not.toContain(key);
    expect(unconfigured).toContain("This version of Cadence cannot sign in to an account.");
  }, 30_000);
});

function build(outDir: string, publicEnv: Record<string, string>): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("VITE_SUPABASE_")) delete env[name];
  const result = spawnSync("npm", ["exec", "--", "vite", "build", "--outDir", outDir, "--emptyOutDir"], {
    cwd: "apps/desktop", env: { ...env, ...publicEnv }, encoding: "utf8", timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return readdirSync(path.join(outDir, "assets")).filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(path.join(outDir, "assets", file), "utf8")).join("\n");
}
