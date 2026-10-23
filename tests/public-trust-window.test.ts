import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { publicTrustWindowHook } from "../scripts/public-trust-window-hook.mjs";

const directory = ".intent/artifacts/trust232/oct22-labeled-window";
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

describe("temporary Trust access cleanup", () => {
  it("passes the isolated Python fault-injection cases without GitHub access", () => {
    expect(() => execFileSync("python3", ["-m", "unittest", "discover", "-s", "tests",
      "-p", "public_trust_window_test.py", "-v"], { timeout: 10000, stdio: "pipe" })).not.toThrow();
  });

  it.each([
    { exitCode: 0, stdout: '{"event":"waiting"}' },
    { exitCode: 0, stdout: '{"event":"retry","reason":"secret"}' },
    { exitCode: 1, stdout: "secret" },
    { exitCode: 0, stdout: "invalid secret JSON" },
    { exitCode: 0, stdout: '{"event":"restored"}' },
    new Error("secret timeout"),
  ])("keeps retry ticks independent of an agent wake and redacts failures", async (result) => {
    const execute = new AsyncFunction("ws", "hookState", publicTrustWindowHook(directory));
    const ws = { host: { exec: async () => {
      if (result instanceof Error) throw result;
      return result;
    } } };
    expect(await execute(ws, { attempts: 2 })).toEqual({
      dispatch: false, state: { restored: false, phase: !(result instanceof Error) && result.stdout === '{"event":"waiting"}' ? "waiting" : "retry", attempts: 3 },
    });
  });

  it("notifies once only after restoration and uses a bounded direct cleanup call", async () => {
    const calls: unknown[] = [];
    const execute = new AsyncFunction("ws", "hookState", publicTrustWindowHook(directory));
    const result = await execute({ host: { exec: async (input: unknown) => {
      calls.push(input);
      return { exitCode: 0, stdout: '{"event":"restored","tagAbsent":true,"other":"secret"}' };
    } } }, null);
    expect(calls).toEqual([{ command: "python3", args: ["scripts/watch-public-trust-window.py", directory], timeoutMs: 50000 }]);
    expect(result).toEqual({ dispatch: true, message: "Diagnostic access restored; verify the retained receipt.", state: { restored: true } });
  });

  it("rejects receipt paths outside the approved local artifact directory", () => {
    for (const path of ["/tmp/arbitrary", ".intent/artifacts/trust232/../other", 'bad"code']) {
      expect(() => publicTrustWindowHook(path)).toThrow("Invalid diagnostic receipt directory");
    }
  });
});
