import { describe, expect, it } from "vitest";
import { checkboxState, checkGuest, permissionLine, scrubLog } from "../scripts/location-vm.mjs";

describe("location VM results", () => {
  it("drops every log line that looks like a coordinate", () => {
    const log = [
      "cadence location result granted reason none",
      "CoreLocationAgent handle auth-prompt",
      "fix 40.712776 -74.005974",
      "lat=-33.8688 lon=151.2093",
    ].join("\n");
    expect(scrubLog(log)).toEqual(["cadence location result granted reason none", "CoreLocationAgent handle auth-prompt"]);
  });

  it("reads the Device location line without the next accessibility field", () => {
    expect(permissionLine("AXStaticText: Device location: denied. To use your current position | other"))
      .toBe("Device location: denied. To use your current position");
    expect(permissionLine("no match")).toBeNull();
  });

  it("reads the Travel estimates checkbox value", () => {
    expect(checkboxState("AXCheckBox: Travel estimates | 1")).toBe("on");
    expect(checkboxState("AXCheckBox: Travel estimates | 0")).toBe("off");
    expect(checkboxState("no match")).toBe("unknown");
  });
});

// Exercise the actual guest sequence without a VM, SSH, privacy prompts or sleep.
// These results prove failure handling, not installed macOS acceptance.
describe("location VM guest checks", () => {
  type State = "never-asked" | "allowed" | "denied";
  const permissions = { "never-asked": "not yet allowed", allowed: "allowed", denied: "blocked" };
  function peer(state: State, options: {
    failCommand?: string; observed?: string; afterRetry?: string; missingButton?: string;
    failedPress?: string; frontmost?: string; notarized?: boolean; installedVersion?: string;
    running?: boolean; startupErrors?: string[];
  } = {}) {
    const commands: string[] = [], actions: string[][] = [];
    const steps: Record<string, string | string[] | null> = {};
    let travel = false, retried = false, installed = false, running = options.running ?? false;
    const startupErrors = [...options.startupErrors ?? []];
    const ok = (out = "") => ({ status: 0, out });
    const exec = (command: string) => {
      commands.push(command);
      if (options.failCommand && command.includes(options.failCommand)) return { status: 1, out: "synthetic failure" };
      if (command.includes("spctl --status")) return ok("27.0\n26A428\nassessments enabled");
      if (command.startsWith("spctl -a")) return ok(options.notarized === false ? "accepted\nsource=Developer ID" : "accepted\nsource=Notarized Developer ID");
      if (command.startsWith("hdiutil attach")) return ok("/dev/disk7\tApple_HFS\t/Volumes/Cadence 0.1.7");
      if (command.startsWith("ps -axww")) return ok("111 /bin/zsh\n222 /usr/bin/pgrep" + (running ? "\n333 /Applications/Cadence.app/Contents/MacOS/cadence-desktop-spike" : ""));
      if (command.includes('tell application "Cadence" to quit')) { running = false; return ok(); }
      if (command.includes("ditto --noqtn")) { installed = true; return ok(); }
      if (command.includes("CFBundleShortVersionString")) return ok(command.includes("/Volumes/") ? "0.1.7" : installed ? options.installedVersion ?? "0.1.7" : "0.1.6");
      if (command.includes("frontmost:true")) return ok(options.frontmost ?? "System Settings");
      if (command.startsWith("cat ")) return ok("cadence location result denied reason status_2");
      return ok();
    };
    const ax = (...args: string[]) => {
      actions.push(args);
      if (args[0] === "find" && args[1] === "^AXButton Open navigation$" && startupErrors.length) {
        return { status: 1, out: startupErrors.shift()! };
      }
      if (args[0] === "press") {
        if (args[2] === options.failedPress) return { status: 1, out: "synthetic press failure" };
        if (args[2] === "Travel estimates") travel = !travel;
        if (args[2] === "Check again") retried = true;
        return ok();
      }
      if (args[1] === "Device location") return ok(`AXStaticText: Device location: ${(retried ? options.afterRetry : undefined) ?? options.observed ?? permissions[state]}.`);
      if (args[1].includes("Travel estimates")) return ok(`AXCheckBox: Travel estimates | ${travel ? "1" : "0"}`);
      const name = args[1].replace(/^\^AXButton /, "").replace(/\$$/, "");
      if (name === options.missingButton || (state === "allowed" && ["Check again", "Open Location Services"].includes(name))) return ok();
      return ok(`AXButton: ${name}`);
    };
    return { commands, actions, steps, controls: { exec, ax, step: (key: string, value: string | string[] | null) => { steps[key] = value; },
      pause: () => {}, waitUntil: (test: () => boolean) => test() } };
  }

  it.each(["never-asked", "allowed", "denied"] as const)("accepts the matching %s state", (state) => {
    const guest = peer(state);
    checkGuest(state, guest.controls);
    expect(guest.steps.permissionAfterRequest).toBe(`Device location: ${permissions[state]}.`);
    expect(guest.commands.some((command) => command.includes("pgrep -f"))).toBe(false);
    expect(guest.commands.some((command) => command.includes('tell application "Cadence" to quit'))).toBe(false);
  });

  it.each(["cp ", "spctl -a -vv -t open", "hdiutil attach", "spctl -a -vv -t exec", "syspolicy_check", "ditto --noqtn", "codesign --verify"])("stops before location checks when %s fails", (failCommand) => {
    const guest = peer("denied", { failCommand });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/failed/);
    expect(guest.actions).toEqual([]);
  });

  it("rejects accepted but unnotarized artifacts before installation", () => {
    const guest = peer("denied", { notarized: false });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/Notarized Developer ID/);
    expect(guest.commands.some((command) => command.includes("ditto"))).toBe(false);
  });

  it("rejects a different installed version", () => {
    const guest = peer("denied", { installedVersion: "0.1.6" });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/does not match the candidate/);
    expect(guest.actions).toEqual([]);
  });

  it("waits for the actual app to quit before replacing its bundle", () => {
    const guest = peer("denied", { running: true });
    checkGuest("denied", guest.controls);
    expect(guest.commands.findIndex((command) => command.includes('tell application "Cadence" to quit')))
      .toBeLessThan(guest.commands.findIndex((command) => command.includes("ditto --noqtn")));
  });

  it("waits for the app process and window after opening Cadence", () => {
    const guest = peer("denied", { startupErrors: ["process not found", "no windows"] });
    checkGuest("denied", { ...guest.controls, waitUntil: (test) => test() || test() || test() });
    expect(guest.actions.filter((args) => args[0] === "find" && args[1] === "^AXButton Open navigation$")).toHaveLength(3);
    expect(guest.steps.permissionAfterRequest).toBe("Device location: blocked.");
  });

  it("fails when the app window does not become ready within the wait", () => {
    const guest = peer("denied", { startupErrors: ["no windows", "no windows", "no windows"] });
    expect(() => checkGuest("denied", { ...guest.controls, waitUntil: (test) => test() || test() || test() }))
      .toThrow("No Cadence window in the copy.");
    expect(guest.actions.some((args) => args[0] === "press")).toBe(false);
  });

  it("rejects a permission that does not match the selected image", () => {
    const guest = peer("allowed", { observed: "blocked" });
    expect(() => checkGuest("allowed", guest.controls)).toThrow(/expected allowed, observed Device location: blocked/);
  });

  it("checks the state again after retrying the location request", () => {
    const guest = peer("denied", { afterRetry: "allowed" });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/permissionAfterCheckAgain: expected blocked/);
  });

  it.each(["Check again", "Open Location Services"])("rejects a missing %s recovery button", (missingButton) => {
    const guest = peer("denied", { missingButton });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/missing for a permission/);
  });

  it.each(["Check again", "Open Location Services"])("rejects a failed %s action", (failedPress) => {
    const guest = peer("denied", { failedPress });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/failed/);
  });

  it("rejects a settings action that leaves another app frontmost", () => {
    const guest = peer("denied", { frontmost: "Finder" });
    expect(() => checkGuest("denied", guest.controls)).toThrow(/did not open System Settings/);
  });
});
