import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop authentication CSP", () => {
  it("allows only Supabase and the exact current and legacy Calendar brokers beyond native IPC", () => {
    const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    const connect = config.app.security.csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
    expect(connect.split(" ")).toEqual(["ipc:", "http://ipc.localhost", "https://*.supabase.co", "https://cadence-blush-three.vercel.app", "https://app.cadence-me.com"]);
    expect(config.app.security.devCsp).toContain("https://cadence-blush-three.vercel.app https://app.cadence-me.com;");
    expect(connect.replace("https://*.supabase.co", "")).not.toContain("*");
  });
});
