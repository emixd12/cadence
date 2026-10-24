import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkDesktopDependencies } from "../scripts/check-desktop-dependencies.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(api = "2.12.4", native = "2.12.4", plugin = "2.10.1", localApi?: string) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-desktop-dependencies-"));
  roots.push(root);
  mkdirSync(path.join(root, "apps/desktop/src-tauri"), { recursive: true });
  const packages: Record<string, { version: string }> = {
    "node_modules/@tauri-apps/api": { version: api },
    "node_modules/@tauri-apps/plugin-updater": { version: "2.10.1" },
  };
  if (localApi) packages["apps/desktop/node_modules/@tauri-apps/api"] = { version: localApi };
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages }));
  writeFileSync(path.join(root, "apps/desktop/package.json"), JSON.stringify({
    dependencies: { "@tauri-apps/api": api, "@tauri-apps/plugin-updater": "2.10.1" },
  }));
  writeFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "tauri"\nversion = "${native}"\n\n[[package]]\nname = "tauri-plugin-updater"\nversion = "${plugin}"\n`);
  return root;
}

describe("desktop dependency compatibility", () => {
  it("accepts paired core minors and exact plugin versions", () => {
    expect(checkDesktopDependencies(fixture("2.12.4", "2.12.3"))).toEqual({ api: "2.12.4", native: "2.12.3" });
  });
  it("rejects the previously unchecked API 2.12/native 2.11 combination", () => {
    expect(() => checkDesktopDependencies(fixture("2.12.4", "2.11.5"))).toThrow("Tauri core version mismatch");
  });
  it("rejects plugin patch drift", () => {
    expect(() => checkDesktopDependencies(fixture("2.12.4", "2.12.4", "2.10.2"))).toThrow("Tauri plugin version mismatch");
  });
  it("checks the desktop-local API rather than a compatible hoisted copy", () => {
    expect(() => checkDesktopDependencies(fixture("2.12.4", "2.12.4", "2.10.1", "2.11.1"))).toThrow("Tauri core version mismatch");
  });
  it("rejects missing native and JavaScript lock entries", () => {
    const root = fixture();
    writeFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.lock"), "version = 4\n");
    expect(() => checkDesktopDependencies(root)).toThrow("Expected one locked native tauri version");
    const missingJavascript = fixture();
    writeFileSync(path.join(missingJavascript, "package-lock.json"), JSON.stringify({ packages: {} }));
    expect(() => checkDesktopDependencies(missingJavascript)).toThrow("Missing locked @tauri-apps/api version");
  });
  it("checks the committed dependency pair", () => {
    expect(() => checkDesktopDependencies()).not.toThrow();
  });
});
