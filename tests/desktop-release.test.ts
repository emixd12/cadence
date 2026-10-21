import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createReleaseBuildEnvironment, createReleaseOverlay, validateReleaseConfiguration, validateSigningEnvironment, decodeUpdaterPublicKey,
  createPreviewBuildEnvironment, createPreviewOverlay, validatePreviewConfiguration, validatePreviewBuildEnvironment,
  validateDesktopPublicServiceEnvironment, PREVIEW_ENDPOINT, UPDATER_QA_ENDPOINT } from "../apps/desktop/scripts/release-config.mjs";

const publicKey = Buffer.from("untrusted comment: test public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n").toString("base64");
const env = { CADENCE_UPDATER_PUBLIC_KEY: publicKey, CADENCE_UPDATER_ENDPOINT: "https://updates.cadence-test.org/latest.json" };
const base = { productName: "Cadence Desktop Spike", identifier: "app.cadence.desktop-spike", version: "0.1.0", app: { windows: [{ label: "main", title: "Spike", width: 1040 }] }, bundle: { macOS: { minimumSystemVersion: "14.0", hardenedRuntime: true } } };

describe("desktop release preparation", () => {
  it("embeds production Keychain entitlements and the supplied profile without applying them to previews", () => {
    const signing = { ...env, CADENCE_APPLE_PROVISIONING_PROFILE: "/protected/Cadence.provisionprofile" };
    expect(createReleaseOverlay(base, signing).bundle.macOS).toEqual({
      entitlements: "Entitlements.plist", files: { "embedded.provisionprofile": signing.CADENCE_APPLE_PROVISIONING_PROFILE },
    });
    const preview = createPreviewOverlay(base, { ...signing, CADENCE_UPDATER_ENDPOINT: PREVIEW_ENDPOINT }, "0.1.1-preview.46");
    expect(preview.bundle.macOS).not.toHaveProperty("entitlements");
    expect(preview.bundle.macOS).not.toHaveProperty("files");
  });
  it("embeds a normalized key envelope and rejects base64 accepted by permissive Node decoding but rejected by the updater", () => {
    const overlay = createReleaseOverlay(base, { ...env, CADENCE_UPDATER_PUBLIC_KEY: `  ${publicKey}\n` });
    expect(overlay.plugins.updater.pubkey).toBe(publicKey);
    expect(validateReleaseConfiguration(base, overlay)).toEqual([]);
    expect(publicKey.endsWith("=")).toBe(true);
    for (const malformed of [publicKey.replace(/=+$/, ""), `${publicKey}=`, Buffer.concat([Buffer.from("untrusted comment: "), Buffer.from([0xff]),
      Buffer.from("\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n")]).toString("base64")]) {
      expect(() => decodeUpdaterPublicKey(malformed)).toThrow();
    }
  });
  it("builds an explicit ad hoc preview with the dedicated feed without modifying production configuration", () => {
    const preview = createPreviewOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: PREVIEW_ENDPOINT, APPLE_PASSWORD: "private-password" }, "0.1.1-preview.2");
    expect(preview).toMatchObject({ version: "0.1.1-preview.2", identifier: "app.cadence.desktop", productName: "Cadence",
      bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: "-", minimumSystemVersion: "14.0", hardenedRuntime: true } } });
    expect(validatePreviewConfiguration(base, preview)).toEqual([]);
    expect(base.version).toBe("0.1.0");
    expect(base.bundle.macOS).not.toHaveProperty("signingIdentity");
    expect(JSON.stringify(preview)).not.toContain("private-password");
  });
  it("allows only the exact reviewed QA feed alongside the dedicated preview feed", () => {
    const preview = createPreviewOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: UPDATER_QA_ENDPOINT }, "0.1.1-preview.46");
    expect(validatePreviewConfiguration(base, preview)).toEqual([]);
    for (const endpoint of [UPDATER_QA_ENDPOINT.replace("https:", "http:"), `${UPDATER_QA_ENDPOINT}?other=1`,
      UPDATER_QA_ENDPOINT.replace("20260928", "20260929"), UPDATER_QA_ENDPOINT.replace("emixd12/", "another-owner/")]) {
      expect(validatePreviewConfiguration(base, createPreviewOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: endpoint }, "0.1.1-preview.46")).length).toBeGreaterThan(0);
    }
  });
  it("requires an explicit preview version and prevents previews using an unreviewed update channel", () => {
    for (const version of ["", "0.1.1", "0.1.1-beta.1", "0.1.1-preview.01", "../0.1.1-preview.1"]) {
      expect(validatePreviewConfiguration(base, createPreviewOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: PREVIEW_ENDPOINT }, version)).length).toBeGreaterThan(0);
    }
    const wrongFeed = createPreviewOverlay(base, env, "0.1.1-preview.1");
    expect(validatePreviewConfiguration(base, wrongFeed).join(" ")).toContain("dedicated preview feed");
    const wrongIdentity = createPreviewOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: PREVIEW_ENDPOINT }, "0.1.1-preview.1");
    wrongIdentity.bundle.macOS.signingIdentity = "Developer ID Application: Example";
    expect(validatePreviewConfiguration(base, wrongIdentity).join(" ")).toContain("ad hoc");
  });
  it("removes every Apple credential from preview child processes while preserving updater signing and forcing CI", () => {
    const caller = { PATH: "/release/tools", CI: "false", APPLE_ID: "secret-id", APPLE_PASSWORD: "secret-password",
      APPLE_CERTIFICATE: "secret-certificate", APPLE_API_KEY_PATH: "/private/key", APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
      TAURI_SIGNING_PRIVATE_KEY: "updater-private-key", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater-password", TAURI_CONFIG: "unreviewed", TAURI_BUNDLER_DMG_IGNORE_CI: "true" };
    expect(createPreviewBuildEnvironment(caller)).toEqual({ PATH: "/release/tools", CI: "true", TAURI_BUNDLER_DMG_IGNORE_CI: "false",
      CADENCE_LEGACY_KEYCHAIN_QA: "1", TAURI_SIGNING_PRIVATE_KEY: "updater-private-key", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater-password" });
    expect(caller.APPLE_PASSWORD).toBe("secret-password");
    const publicAuth = { VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    expect(validatePreviewBuildEnvironment({ TAURI_SIGNING_PRIVATE_KEY: "updater-key", ...publicAuth })).toEqual([]);
    expect(validatePreviewBuildEnvironment({}).join(" ")).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(validatePreviewBuildEnvironment(caller).join(" ")).toContain("TAURI_CONFIG");
    expect(validateSigningEnvironment({ TAURI_SIGNING_PRIVATE_KEY: "updater-key" }).join(" ")).toContain("VITE_SUPABASE_URL");
  });
  it("refuses account-sync preview builds without public Supabase configuration", () => {
    const signing = { TAURI_SIGNING_PRIVATE_KEY: "updater-key" };
    const anonPayload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    expect(validatePreviewBuildEnvironment({ ...signing, VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_ANON_KEY: `x.${anonPayload}.x` })).toEqual([]);
    for (const candidate of [
      signing,
      { ...signing, VITE_SUPABASE_URL: "http://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
      { ...signing, VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" },
      { ...signing, VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_ANON_KEY: `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x` },
    ]) expect(validatePreviewBuildEnvironment(candidate).length).toBeGreaterThan(0);
  });
  it("requires a public production service origin explicitly permitted by the native CSP", () => {
    const native = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    const origin = "https://app.cadence-me.com";
    for (const value of [origin, `${origin}/`, `  ${origin}  `, "https://cadence-blush-three.vercel.app"]) {
      expect(validateDesktopPublicServiceEnvironment({ VITE_CALENDAR_BROKER_ORIGIN: value }, native)).toEqual([]);
    }
    for (const value of [undefined, "", "http://app.cadence-me.com", "https://example.com", "https://localhost",
      "https://user:private-password@app.cadence-me.com", `${origin}/api`, `${origin}?key=private-key`, `${origin}#fragment`]) {
      const errors = validateDesktopPublicServiceEnvironment({ VITE_CALENDAR_BROKER_ORIGIN: value }, native);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join(" ")).not.toMatch(/private-password|private-key/);
    }
    const blocked = { app: { security: { csp: "default-src 'self'; connect-src https://*.cadence-me.com" } } };
    expect(validateDesktopPublicServiceEnvironment({ VITE_CALENDAR_BROKER_ORIGIN: origin }, blocked).join(" ")).toContain("production CSP");
    for (const policy of [native.app.security.csp, native.app.security.devCsp]) {
      expect(policy).toContain(` ${origin};`);
      expect(policy).toContain("https://cadence-blush-three.vercel.app");
    }
    expect(validatePreviewBuildEnvironment({ TAURI_SIGNING_PRIVATE_KEY: "updater-key",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toEqual([]);
  });
  it("disables Finder scripting even when the caller environment overrides CI defaults", () => {
    const caller = { CI: "false", TAURI_BUNDLER_DMG_IGNORE_CI: "true", CADENCE_LEGACY_KEYCHAIN_QA: "1", PATH: "/release/tools" };
    expect([createReleaseBuildEnvironment(caller), caller]).toEqual([
      { CI: "true", TAURI_BUNDLER_DMG_IGNORE_CI: "false", PATH: "/release/tools" },
      { CI: "false", TAURI_BUNDLER_DMG_IGNORE_CI: "true", CADENCE_LEGACY_KEYCHAIN_QA: "1", PATH: "/release/tools" },
    ]);
  });
  it("uses the final identity without mutating active native configuration or copying signing secrets", () => {
    const overlay = createReleaseOverlay(base, { ...env, TAURI_SIGNING_PRIVATE_KEY: "private-value", APPLE_PASSWORD: "private-password" });
    expect(overlay).toMatchObject({ productName: "Cadence", identifier: "app.cadence.desktop", bundle: { createUpdaterArtifacts: true } });
    expect(overlay.app.windows[0]).toMatchObject({ title: "Cadence", width: 1040 });
    expect(base.identifier).toBe("app.cadence.desktop-spike");
    expect(JSON.stringify(overlay)).not.toContain("private-");
    expect(validateReleaseConfiguration(base, overlay)).toEqual([]);
  });
  it("rejects absent, placeholder, insecure and credential-bearing endpoints or invalid keys", () => {
    for (const endpoint of ["", "http://updates.cadence-test.org/latest.json", "https://example.com/latest.json", "https://updates.invalid/latest.json", "https://user:secret@updates.cadence-test.org/latest.json"]) {
      expect(validateReleaseConfiguration(base, createReleaseOverlay(base, { ...env, CADENCE_UPDATER_ENDPOINT: endpoint })).length).toBeGreaterThan(0);
    }
    for (const key of ["", "placeholder", Buffer.from("private key data").toString("base64")]) {
      expect(() => decodeUpdaterPublicKey(key)).toThrow();
    }
  });
  it("rejects weakened native identity, TLS, minimum OS and artifact settings", () => {
    const good = createReleaseOverlay(base, env);
    for (const overlay of [
      { ...good, identifier: base.identifier },
      { ...good, bundle: { ...good.bundle, createUpdaterArtifacts: false } },
      { ...good, plugins: { updater: { ...good.plugins.updater, dangerousAcceptInvalidCerts: true } } },
    ]) expect(validateReleaseConfiguration(base, overlay).length).toBeGreaterThan(0);
    expect(validateReleaseConfiguration({ ...base, bundle: { macOS: { minimumSystemVersion: "13.0", hardenedRuntime: false } } }, good).length).toBeGreaterThan(0);
  });
  it("requires real signing and one complete notarization credential set without printing values", () => {
    expect(validateSigningEnvironment({})).toHaveLength(6);
    const credentials = { APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (ABCDEFGHIJ)", TAURI_SIGNING_PRIVATE_KEY: "test-key", APPLE_ID: "private@example.org", APPLE_PASSWORD: "private-password", APPLE_TEAM_ID: "ABCDEFGHIJ",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      VITE_CALENDAR_BROKER_ORIGIN: "https://app.cadence-me.com" };
    expect(validateSigningEnvironment(credentials)).toEqual([]);
    expect(validateSigningEnvironment({ ...credentials, APPLE_SIGNING_IDENTITY: "-" })).toHaveLength(1);
    expect(validateSigningEnvironment({ ...credentials, APPLE_PASSWORD: "" }).join(" ")).not.toContain("private@example.org");
  });
});
