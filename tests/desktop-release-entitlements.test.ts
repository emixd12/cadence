import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real verifier with stubbed codesign/security output. Signed-artifact evidence comes from release runs.
const script = path.resolve("apps/desktop/scripts/verify-entitlements.py");
const team = "HK26VT477G";
const identifier = `${team}.app.cadence.desktop`;

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>
`;
}

// Production also signs the Hardened Runtime location entitlement, which profiles never list.
function entitlements(groups = [identifier], extra = "<key>com.apple.security.personal-information.location</key><true/>"): string {
  return `<dict>
  <key>com.apple.application-identifier</key><string>${identifier}</string>
  <key>com.apple.developer.team-identifier</key><string>${team}</string>
  <key>keychain-access-groups</key><array>${groups.map((group) => `<string>${group}</string>`).join("")}</array>
  ${extra}
</dict>`;
}

function profile({ teamId = team, groups = [`${team}.*`], expires = "2031-09-17T00:00:00Z" } = {}): string {
  return plist(`<dict>
  <key>TeamIdentifier</key><array><string>${teamId}</string></array>
  <key>ExpirationDate</key><date>${expires}</date>
  <key>Entitlements</key><dict>
    <key>com.apple.application-identifier</key><string>${identifier}</string>
    <key>com.apple.developer.team-identifier</key><string>${team}</string>
    <key>keychain-access-groups</key><array>${groups.map((group) => `<string>${group}</string>`).join("")}</array>
  </dict>
</dict>`);
}

describe.skipIf(process.platform === "win32")("production entitlement verifier", () => {
  let directory: string;
  let app: string;
  let expected: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "cadence-entitlements-"));
    app = path.join(directory, "Cadence.app");
    mkdirSync(path.join(app, "Contents"), { recursive: true });
    mkdirSync(path.join(directory, "bin"));
    expected = path.join(directory, "Entitlements.plist");
    writeFileSync(expected, plist(entitlements()));
    writeFileSync(path.join(directory, "signed.plist"), plist(entitlements()));
    writeFileSync(path.join(directory, "profile.plist"), profile());
    writeFileSync(path.join(app, "Contents", "embedded.provisionprofile"), "synthetic signed profile");
    // codesign prints signed entitlements; security prints the decoded profile.
    for (const [tool, source] of [["codesign", "signed.plist"], ["security", "profile.plist"]]) {
      const stub = path.join(directory, "bin", tool);
      writeFileSync(stub, `#!${process.execPath}
const fs = require("node:fs");
process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(directory, source))}));
`);
      chmodSync(stub, 0o700);
    }
    env = { ...process.env, PATH: `${path.join(directory, "bin")}:${process.env.PATH}` };
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const verify = () => spawnSync("python3", ["-I", script, app, expected], { env, encoding: "utf8" });

  it("accepts signed entitlements that match and a profile that authorizes them", () => {
    const result = verify();
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["missing signed entitlements", () => writeFileSync(path.join(directory, "signed.plist"), ""), "could not be read"],
    ["a different Keychain group", () => writeFileSync(path.join(directory, "signed.plist"), plist(entitlements([`${team}.other`]))), "do not exactly match"],
    ["no embedded profile", () => rmSync(path.join(app, "Contents", "embedded.provisionprofile")), "must embed"],
    ["a symlinked profile", () => {
      rmSync(path.join(app, "Contents", "embedded.provisionprofile"));
      symlinkSync(path.join(directory, "profile.plist"), path.join(app, "Contents", "embedded.provisionprofile"));
    }, "must embed"],
    ["another team's profile", () => writeFileSync(path.join(directory, "profile.plist"), profile({ teamId: "ABCDEFGHIJ" })), "different team"],
    ["an expired profile", () => writeFileSync(path.join(directory, "profile.plist"), profile({ expires: "2020-01-01T00:00:00Z" })), "expired"],
    ["a profile without the Keychain group", () => writeFileSync(path.join(directory, "profile.plist"), profile({ groups: ["ABCDEFGHIJ.*"] })), "keychain-access-groups"],
    ["a false location entitlement", () => {
      const value = plist(entitlements([identifier], "<key>com.apple.security.personal-information.location</key><false/>"));
      writeFileSync(expected, value); writeFileSync(path.join(directory, "signed.plist"), value);
    }, "must be true"],
    ["another runtime exception the profile does not authorize", () => {
      const value = plist(entitlements([identifier], "<key>com.apple.security.cs.disable-library-validation</key><true/>"));
      writeFileSync(expected, value); writeFileSync(path.join(directory, "signed.plist"), value);
    }, "does not authorize com.apple.security.cs.disable-library-validation"],
  ])("rejects %s", (_name, change, message) => {
    change();
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});

describe("production location access (Ticket 165)", () => {
  // Hardened Runtime blocks Location Services unless the signature carries this entitlement.
  it("signs the location entitlement and declares the macOS usage strings", () => {
    const native = path.resolve("apps/desktop/src-tauri");
    expect(readFileSync(path.join(native, "Entitlements.plist"), "utf8"))
      .toMatch(/<key>com\.apple\.security\.personal-information\.location<\/key>\s*<true\/>/);
    const info = readFileSync(path.join(native, "Info.plist"), "utf8");
    expect(info).toContain("<key>NSLocationUsageDescription</key>");
    expect(info).toContain("<key>NSLocationWhenInUseUsageDescription</key>");
  });
});
