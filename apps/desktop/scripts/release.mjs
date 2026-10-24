import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReleaseBuildEnvironment, createReleaseOverlay, validateReleaseConfiguration, validateSigningEnvironment,
  createPreviewBuildEnvironment, createPreviewOverlay, validatePreviewConfiguration, validatePreviewBuildEnvironment,
  createDevBuildEnvironment, createDevOverlay, validateDevConfiguration, validateDevBuildEnvironment,
  RELEASE_IDENTIFIER, RELEASE_NAME, RELEASE_TARGET } from "./release-config.mjs";
import { verifyUpdaterSignature } from "./verify-updater-signature.mjs";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(desktop, "../..");
const native = path.join(desktop, "src-tauri");
const base = JSON.parse(fs.readFileSync(path.join(native, "tauri.conf.json"), "utf8"));
const command = process.argv[2] ?? "check";
const preview = command.startsWith("preview-");
// Dev-signed builds use the production signature and entitlements, skip notarization, and are never published.
const dev = command.startsWith("dev-");
const version = preview || dev ? process.argv[3] : base.version;
const overlay = preview ? createPreviewOverlay(base, process.env, version)
  : dev ? createDevOverlay(base, process.env, version) : createReleaseOverlay(base, process.env);
const releaseDirectory = path.join(desktop, ".release");
// Staged outside any checkout, in the Spotlight-excluded private release store.
const devBuildDirectory = path.join(path.resolve(process.env.CADENCE_RELEASE_STORE
  || path.join(os.homedir(), "Library", "Application Support", "Cadence Release")), "dev-builds", String(version));
// Verification tools need neither Apple credentials nor the private updater key.
const verificationEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("APPLE_") && !key.startsWith("TAURI_SIGNING_PRIVATE_KEY") && key !== "TAURI_CONFIG"));

function run(binary, args, cwd = root, env = verificationEnvironment) {
  const result = spawnSync(binary, args, { cwd, env, encoding: "utf8", stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(binary)} ${args[0] ?? ""} failed.`);
}
function capture(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, env: verificationEnvironment, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(binary)} verification failed.`);
  return result.stdout;
}
function configurationErrors() {
  return preview ? validatePreviewConfiguration(base, overlay)
    : dev ? validateDevConfiguration(base, overlay) : validateReleaseConfiguration(base, overlay);
}
function preflight({ readiness = false, build = false } = {}) {
  const errors = configurationErrors();
  if (dev) errors.push(...validateDevBuildEnvironment(process.env, base));
  else if (!preview) errors.push(...validateSigningEnvironment(process.env, base));
  else if (build) errors.push(...validatePreviewBuildEnvironment(process.env));
  if (process.platform !== "darwin" || process.arch !== "arm64") errors.push("The initial release must build on an Apple Silicon Mac.");
  if (!preview) {
    const profile = process.env.CADENCE_APPLE_PROVISIONING_PROFILE;
    if (!profile || !path.isAbsolute(profile) || !fs.existsSync(profile) || !fs.statSync(profile).isFile()) {
      errors.push("CADENCE_APPLE_PROVISIONING_PROFILE must name an existing absolute Developer ID provisioning-profile path.");
    }
    try {
      const identities = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
      if (!process.env.APPLE_SIGNING_IDENTITY || !identities.includes(`"${process.env.APPLE_SIGNING_IDENTITY}"`)) errors.push("The configured Developer ID Application identity is not valid in the local keychain.");
    } catch { errors.push("The local signing keychain could not be verified."); }
    if (!dev && process.env.APPLE_API_KEY_PATH && !fs.existsSync(process.env.APPLE_API_KEY_PATH)) errors.push("APPLE_API_KEY_PATH does not point to an available notarization key.");
  }
  const tools = [["xcrun", ["--find", preview || dev ? "vtool" : "stapler"]], ...(dev ? [] : [["minisign", ["-v"]]]), ["python3", ["-c", "import tarfile"]]];
  for (const [binary, args] of tools) {
    try { capture(binary, args); } catch { errors.push(`${binary} is required for release verification.`); }
  }
  // A candidate is needed to test the updater interaction. Final readiness still requires that real evidence.
  const parity = spawnSync(process.execPath, ["scripts/check-interactions.mjs", ...(readiness ? ["--desktop-release"] : [])], { cwd: root, env: verificationEnvironment, encoding: "utf8" });
  if (parity.status !== 0) errors.push(`Desktop interaction parity is incomplete.\n${parity.stdout}${parity.stderr}`.trim());
  if (errors.length) throw new Error(errors.join("\n"));
}
function exactlyOne(directory, suffix) {
  const entries = fs.readdirSync(directory).filter((entry) => entry.endsWith(suffix));
  if (entries.length !== 1) throw new Error(`Expected exactly one ${suffix} artifact in ${directory}.`);
  return path.join(directory, entries[0]);
}
function verify(bundleDirectory, frontendPublicConfiguration) {
  const errors = configurationErrors();
  if (!preview && !process.env.APPLE_SIGNING_IDENTITY?.startsWith("Developer ID Application:")) errors.push("APPLE_SIGNING_IDENTITY is required to verify the expected signing authority.");
  if (errors.length) throw new Error(errors.join("\n"));
  const app = path.join(bundleDirectory, "macos", `${RELEASE_NAME}.app`);
  const archive = `${app}.tar.gz`;
  const signatureFile = `${archive}.sig`;
  const dmg = dev ? null : exactlyOne(path.join(bundleDirectory, "dmg"), ".dmg");
  const plist = path.join(app, "Contents", "Info.plist");
  const value = (key) => capture("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]).trim();
  if (value("CFBundleIdentifier") !== RELEASE_IDENTIFIER || value("CFBundleShortVersionString") !== version) throw new Error("The signed app identity/version does not match this candidate.");
  const executableName = value("CFBundleExecutable");
  if (!/^[A-Za-z0-9_.-]+$/.test(executableName) || [".", ".."].includes(executableName)) throw new Error("The app executable name is invalid.");
  const executable = path.join(app, "Contents", "MacOS", executableName);
  const legacyKeychain = fs.readFileSync(executable).includes(Buffer.from("app.cadence.desktop.auth.legacy-qa"));
  if (preview && !legacyKeychain) {
    throw new Error("The ad hoc preview must use the legacy macOS login Keychain path.");
  }
  if (!preview && legacyKeychain) throw new Error("The production app must not use the legacy macOS login Keychain path.");
  if (value("LSMinimumSystemVersion") !== "14.0") throw new Error("The app does not declare macOS 14.0 minimum.");
  const signing = spawnSync("codesign", ["--display", "--verbose=4", app], { env: verificationEnvironment, encoding: "utf8" });
  if (signing.status !== 0 || !/flags=0x[0-9a-f]+\([^)]*\bruntime\b[^)]*\)/i.test(signing.stderr)
    || !/^Info.plist entries=\d+/m.test(signing.stderr) || !/^Sealed Resources version=\d+/m.test(signing.stderr)) {
    throw new Error("The app must have hardened runtime, bound Info.plist, and sealed resources.");
  }
  if (preview ? !signing.stderr.split("\n").includes("Signature=adhoc")
    : !signing.stderr.split("\n").includes(`Authority=${process.env.APPLE_SIGNING_IDENTITY}`)) {
    throw new Error(preview ? "The preview app must use ad hoc signing." : "The app does not use the expected Developer ID authority.");
  }
  if (capture("lipo", ["-archs", executable]).trim() !== "arm64") throw new Error("The initial release must contain only the arm64 executable.");
  if (!/minos\s+14\.0(?:\s|$)/.test(capture("xcrun", ["vtool", "-show-build", executable]))) throw new Error("The executable does not declare macOS 14.0 minimum.");
  run("codesign", ["--verify", "--deep", "--strict", app]);
  // Production Keychain access depends on these signed entitlements and the profile that authorizes them.
  if (!preview) run("python3", [path.join(desktop, "scripts", "verify-entitlements.py"), app, path.join(native, "Entitlements.plist")]);
  const binarySha256 = createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
  if (dev) {
    return { milestone: "dev-signed build", identifier: RELEASE_IDENTIFIER, version, target: RELEASE_TARGET, checkedAt: new Date().toISOString(),
      frontendPublicConfiguration: frontendPublicConfiguration ?? "not verified by this command",
      checks: ["strict codesign", "hardened runtime", "bound Info.plist", "sealed resources", "arm64", "compiled macOS 14 minimum", "Developer ID authority",
        "production Keychain path", "signed entitlements match Entitlements.plist", "embedded provisioning profile authorizes entitlements"],
      binarySha256, teamIdentifier: /^TeamIdentifier=(.+)$/m.exec(signing.stderr)?.[1] ?? "not reported",
      secureTimestamp: "not requested", notarization: "not performed", gatekeeper: "not assessed", distribution: "install only on the owner's Macs; never publish",
      declaredMinimumMacOS: "14.0", macOS14Compatibility: "not verified by this script", installation: "not performed by this command", publication: "not performed" };
  }
  if (!preview) {
    run("codesign", ["--verify", "--deep", "--strict", dmg]);
    for (const artifact of [app, dmg]) run("xcrun", ["stapler", "validate", artifact]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
    run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]);
  }
  run("python3", [path.join(desktop, "scripts", "verify-dmg.py"), dmg, app]);
  verifyUpdaterSignature({ archivePath: archive, publicKey: overlay.plugins.updater.pubkey,
    signature: fs.readFileSync(signatureFile, "utf8") });
  // Inspect every archive entry without extracting archive-controlled paths or following links.
  run("python3", [path.join(desktop, "scripts", "verify-updater-archive.py"), archive, app]);
  return { milestone: preview ? "unnotarized preview" : "production candidate", identifier: RELEASE_IDENTIFIER, version, target: RELEASE_TARGET, checkedAt: new Date().toISOString(),
    frontendPublicConfiguration: frontendPublicConfiguration ?? "not verified by this command",
    checks: ["strict codesign", "hardened runtime", "bound Info.plist", "sealed resources", "arm64", "compiled macOS 14 minimum", "read-only DMG contents match app", "updater signature", "updater archive contents match app",
      ...(preview ? ["ad hoc app signature", "legacy macOS login Keychain"] : ["Developer ID authority", "signed entitlements match Entitlements.plist", "embedded provisioning profile authorizes entitlements", "Gatekeeper", "stapled notarization"])],
    artifacts: [dmg, archive, signatureFile].map((file) => ({ file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })),
    binarySha256,
    appleTrust: preview ? "Developer ID, notarization, and Gatekeeper acceptance deferred; not verified" : "artifact checks passed; downloaded launch remains unverified",
    declaredMinimumMacOS: "14.0", macOS14Compatibility: "not verified by this script", downloadedLaunch: "not verified by this script",
    upgradePreservation: "not verified by this script", migrationRecovery: "not verified by this script", feedAvailability: "not verified by this script", publication: "not performed" };
}

function writeReport(report, directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "artifact-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${preview ? "Unnotarized preview" : "Signed production"} artifacts passed local verification. Downloaded launch, live upgrade preservation, and publication remain separate gates.\n`);
}

function prunePreviewApps(keepVersion) {
  const parts = (value) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.([1-9]\d*)$/.exec(value)?.slice(1).map(BigInt);
  const keep = parts(keepVersion);
  const previews = fs.realpathSync(path.join(releaseDirectory, "preview"));
  if (!keep || !fs.existsSync(path.join(previews, keepVersion, "bundle", "macos", "Cadence.app"))) {
    throw new Error("Keep an existing unpacked preview version before pruning.");
  }
  const removals = [];
  for (const entry of fs.readdirSync(previews, { withFileTypes: true })) {
    const candidate = parts(entry.name);
    if (!entry.isDirectory() || !candidate) continue;
    const differing = candidate.findIndex((part, index) => part !== keep[index]);
    if (differing < 0 || candidate[differing] > keep[differing]) continue;
    const directory = path.join(previews, entry.name);
    const app = path.join(directory, "bundle", "macos", "Cadence.app");
    if (!fs.existsSync(app)) continue;
    const report = JSON.parse(fs.readFileSync(path.join(directory, "artifact-verification.json"), "utf8"));
    if (report.identifier !== RELEASE_IDENTIFIER || report.version !== entry.name) throw new Error("Preview report identity mismatch.");
    // Verify retained artifacts against the original report before removing any unpacked app.
    const archive = `${app}.tar.gz`;
    const signature = `${archive}.sig`;
    const dmg = exactlyOne(path.join(directory, "bundle", "dmg"), ".dmg");
    for (const file of [app, archive, signature, dmg]) {
      if (fs.realpathSync(file) !== file) throw new Error("Preview cleanup refuses symlinked artifact paths.");
    }
    for (const file of [archive, signature, dmg]) {
      const recorded = report.artifacts?.find((artifact) => fs.realpathSync(artifact.file) === file);
      if (!recorded || createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== recorded.sha256) {
        throw new Error(`Retained artifact no longer matches its verification report: ${file}`);
      }
    }
    run("python3", [path.join(desktop, "scripts", "verify-updater-archive.py"), archive, app]);
    removals.push(app);
  }
  for (const app of removals) fs.rmSync(app, { recursive: true });
  process.stdout.write(`Removed ${removals.length} verified redundant preview apps; retained archives and ${keepVersion}.\n`);
}

function stagePreview(bundleDirectory, directory, frontendPublicConfiguration) {
  const destination = path.join(directory, "bundle");
  if (fs.existsSync(destination)) throw new Error("This preview version already has staged artifacts. Use a new version; existing evidence was not replaced.");
  const temporary = fs.mkdtempSync(path.join(directory, ".candidate-"));
  try {
    const bundle = path.join(temporary, "bundle");
    fs.mkdirSync(path.join(bundle, "macos"), { recursive: true });
    fs.mkdirSync(path.join(bundle, "dmg"));
    const app = path.join(bundleDirectory, "macos", `${RELEASE_NAME}.app`);
    for (const source of [app, `${app}.tar.gz`, `${app}.tar.gz.sig`]) {
      fs.cpSync(source, path.join(bundle, "macos", path.basename(source)), { recursive: true, verbatimSymlinks: true });
    }
    const dmg = exactlyOne(path.join(bundleDirectory, "dmg"), ".dmg");
    fs.copyFileSync(dmg, path.join(bundle, "dmg", path.basename(dmg)));
    const report = verify(bundle, frontendPublicConfiguration);
    fs.renameSync(bundle, destination);
    report.artifacts = report.artifacts.map((artifact) => ({ ...artifact, file: path.join(destination, path.relative(bundle, artifact.file)) }));
    writeReport(report, directory);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const builtApp = path.join(bundleDirectory, "macos", `${RELEASE_NAME}.app`);
  run("python3", [path.join(desktop, "scripts", "verify-updater-archive.py"),
    path.join(destination, "macos", `${RELEASE_NAME}.app.tar.gz`), builtApp]);
  fs.rmSync(builtApp, { recursive: true });
  prunePreviewApps(version);
}

// Migrations missing from origin/main could leave the owner's database unreadable by later builds,
// so the install script refuses them unless the owner says otherwise.
function devSource() {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, env: verificationEnvironment, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const migrations = path.join(native, "migrations");
  const files = fs.existsSync(migrations) ? fs.readdirSync(migrations).filter((file) => /^\d+_[A-Za-z0-9_]+\.sql$/.test(file)).sort() : [];
  const unmergedMigrations = files.filter((file) => {
    const merged = spawnSync("git", ["show", `origin/main:${path.relative(root, path.join(migrations, file)).split(path.sep).join("/")}`],
      { cwd: root, env: verificationEnvironment, maxBuffer: 16 * 1024 * 1024 });
    return merged.status !== 0 || !merged.stdout.equals(fs.readFileSync(path.join(migrations, file)));
  });
  const status = git("status", "--porcelain");
  return { commit: git("rev-parse", "HEAD"), branch: git("branch", "--show-current") || null, clean: status === null ? null : status === "",
    sqliteSchemaVersion: files.length ? Number.parseInt(files.at(-1), 10) : null, unmergedMigrations };
}

function stageDev(bundleDirectory, frontendPublicConfiguration, source) {
  const parent = path.dirname(devBuildDirectory);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(parent, ".candidate-"));
  const builtApp = path.join(bundleDirectory, "macos", `${RELEASE_NAME}.app`);
  try {
    const bundle = path.join(temporary, "bundle");
    const stagedApp = path.join(bundle, "macos", `${RELEASE_NAME}.app`);
    fs.mkdirSync(path.join(bundle, "macos"), { recursive: true });
    fs.cpSync(builtApp, stagedApp, { recursive: true, verbatimSymlinks: true });
    // Replace Tauri's ad hoc signature. No secure timestamp: only notarization needs one, and requesting it
    // would contact Apple's timestamp server. One signature covers only a bundle without nested code.
    if (["Frameworks", "PlugIns", "Helpers", "XPCServices", "Library"].some((name) => fs.existsSync(path.join(stagedApp, "Contents", name)))
      || fs.readdirSync(path.join(stagedApp, "Contents", "MacOS")).length !== 1) throw new Error("Dev-signed builds support only a single-executable app bundle without nested code.");
    run("codesign", ["--force", "--sign", process.env.APPLE_SIGNING_IDENTITY, "--options", "runtime", "--timestamp=none",
      "--entitlements", path.join(native, "Entitlements.plist"), stagedApp]);
    const report = { ...verify(bundle, frontendPublicConfiguration), source };
    fs.renameSync(temporary, devBuildDirectory);
    report.app = path.join(devBuildDirectory, "bundle", "macos", `${RELEASE_NAME}.app`);
    fs.writeFileSync(path.join(devBuildDirectory, "dev-verification.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  // Leave no second unpacked Cadence in the checkout for Launch Services to find.
  fs.rmSync(builtApp, { recursive: true });
  process.stdout.write(`Dev-signed ${version} passed local verification. It is not notarized; never publish it.\n`
    + `Install it with: node apps/desktop/scripts/install-dev-build.mjs ${version}\n`);
}

function containsBytes(directory, value) {
  const expected = Buffer.from(value);
  return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? containsBytes(candidate, value)
      : entry.isFile() && fs.readFileSync(candidate).includes(expected);
  });
}

function verifyBuiltPublicConfiguration(env) {
  const url = env.VITE_SUPABASE_URL.trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY.trim());
  const dist = path.join(desktop, "dist");
  if (!containsBytes(dist, url) || !containsBytes(dist, key)) {
    throw new Error("The freshly built desktop frontend omits its reviewed public Supabase configuration.");
  }
  if (!preview && !containsBytes(dist, env.VITE_CALENDAR_BROKER_ORIGIN.trim())) {
    throw new Error("The freshly built desktop frontend omits VITE_CALENDAR_BROKER_ORIGIN required for production Calendar, Daily Brief, and Travel.");
  }
  return { source: "fresh frontend before Tauri build", present: ["VITE_SUPABASE_URL",
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ? "VITE_SUPABASE_PUBLISHABLE_KEY" : "VITE_SUPABASE_ANON_KEY",
    ...(!preview ? ["VITE_CALENDAR_BROKER_ORIGIN"] : [])] };
}

function buildCandidate() {
  preflight({ build: true });
  if (dev && fs.existsSync(devBuildDirectory)) throw new Error("This dev version already exists. Use the next dev number; existing builds are never replaced.");
  const source = dev ? devSource() : null;
  const directory = preview ? path.join(releaseDirectory, "preview", version) : dev ? path.join(releaseDirectory, "dev", version) : releaseDirectory;
  if (preview && fs.existsSync(path.join(directory, "bundle"))) throw new Error("This preview version already has staged artifacts. Use a new version; existing evidence was not replaced.");
  fs.mkdirSync(directory, { recursive: true });
  const config = path.join(directory, preview ? "tauri.preview.conf.json" : dev ? "tauri.dev.conf.json" : "tauri.release.conf.json");
  fs.writeFileSync(config, `${JSON.stringify(overlay, null, 2)}\n`);
  const buildEnvironment = preview ? createPreviewBuildEnvironment(process.env)
    : dev ? createDevBuildEnvironment(process.env) : createReleaseBuildEnvironment(process.env);
  run("npm", ["run", "build"], desktop, buildEnvironment);
  const frontendPublicConfiguration = verifyBuiltPublicConfiguration(buildEnvironment);
  run("npm", ["exec", "--", "tauri", "build", "--ci", "--target", RELEASE_TARGET, "--config", config], desktop,
    buildEnvironment);
  const bundle = path.join(native, "target", RELEASE_TARGET, "release", "bundle");
  if (preview) stagePreview(bundle, directory, frontendPublicConfiguration);
  else if (dev) stageDev(bundle, frontendPublicConfiguration, source);
  else {
    // Tauri notarizes and staples the app before creating and signing its DMG.
    const dmg = exactlyOne(path.join(bundle, "dmg"), ".dmg");
    const credentials = process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
      ? ["--apple-id", process.env.APPLE_ID, "--password", process.env.APPLE_PASSWORD, "--team-id", process.env.APPLE_TEAM_ID]
      : ["--key", process.env.APPLE_API_KEY_PATH, "--key-id", process.env.APPLE_API_KEY, "--issuer", process.env.APPLE_API_ISSUER];
    let status;
    try {
      // Capture credential-bearing subprocess output; never relay it or parser errors to logs.
      status = JSON.parse(capture("xcrun", ["notarytool", "submit", dmg, ...credentials, "--wait", "--output-format", "json"]))?.status;
    } catch { throw new Error("The DMG notarization submission failed or returned invalid JSON."); }
    if (status !== "Accepted") throw new Error("Apple did not accept the DMG notarization submission.");
    run("xcrun", ["stapler", "staple", dmg]);
    writeReport(verify(bundle, frontendPublicConfiguration), directory);
  }
}

try {
  if (command === "check" && [2, 3].includes(process.argv.length)) {
    preflight({ readiness: true });
    process.stdout.write("Release prerequisites passed. No artifacts were built or published.\n");
  } else if (command === "build" && process.argv.length === 3) {
    buildCandidate();
  } else if (command === "verify" && process.argv.length === 4) {
    writeReport(verify(path.resolve(process.argv[3])), releaseDirectory);
  } else if (command === "preview-check" && process.argv.length === 4) {
    preflight();
    process.stdout.write("Preview candidate prerequisites passed without Apple credentials. No artifacts were built; final release readiness is not established.\n");
  } else if (command === "preview-build" && process.argv.length === 4) {
    buildCandidate();
  } else if (command === "preview-prune" && process.argv.length === 4) {
    prunePreviewApps(version);
  } else if (command === "preview-verify" && process.argv.length === 5) {
    const report = verify(path.resolve(process.argv[4]));
    writeReport(report, path.join(releaseDirectory, "preview", version));
  } else if (command === "dev-check" && process.argv.length === 4) {
    preflight();
    process.stdout.write("Dev-signed build prerequisites passed. Nothing was built, notarized or published.\n");
  } else if (command === "dev-build" && process.argv.length === 4) {
    buildCandidate();
  } else throw new Error("Usage: release.mjs check|build|verify <bundle-directory> | preview-check|preview-build|preview-prune <version> | preview-verify <version> <bundle-directory> | dev-check|dev-build <X.Y.Z-dev.N>");
} catch (error) {
  process.stderr.write(`Desktop release check failed:\n${error.message}\n`);
  process.exitCode = 1;
}
