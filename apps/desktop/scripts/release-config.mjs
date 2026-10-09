export const RELEASE_IDENTIFIER = "app.cadence.desktop";
export const RELEASE_NAME = "Cadence";
export const RELEASE_TARGET = "aarch64-apple-darwin";
export const PREVIEW_ENDPOINT = "https://github.com/emixd12/cadence/releases/download/desktop-preview/latest.json";

export function createReleaseBuildEnvironment(env) {
  return { ...env, CI: "true", TAURI_BUNDLER_DMG_IGNORE_CI: "false" };
}

export function createPreviewBuildEnvironment(env) {
  // Never let installed Apple credentials turn a preview into an accidental notarization submission.
  return { ...createReleaseBuildEnvironment(Object.fromEntries(Object.entries(env)
    .filter(([key]) => !key.startsWith("APPLE_") && key !== "TAURI_CONFIG"))), CADENCE_LEGACY_KEYCHAIN_QA: "1" };
}

export function createReleaseOverlay(base, env) {
  return {
    productName: RELEASE_NAME,
    identifier: RELEASE_IDENTIFIER,
    build: { beforeBuildCommand: "" },
    app: { windows: base.app.windows.map((window) => ({ ...window, title: RELEASE_NAME })) },
    bundle: { targets: ["app", "dmg"], createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: (env.CADENCE_UPDATER_PUBLIC_KEY ?? "").trim(), endpoints: [env.CADENCE_UPDATER_ENDPOINT ?? ""], dangerousInsecureTransportProtocol: false, dangerousAcceptInvalidCerts: false, dangerousAcceptInvalidHostnames: false } },
  };
}

export function createPreviewOverlay(base, env, version) {
  const overlay = createReleaseOverlay(base, env);
  return { ...overlay, version, bundle: { ...overlay.bundle,
    macOS: { signingIdentity: "-", minimumSystemVersion: "14.0", hardenedRuntime: true } } };
}

export function validatePreviewConfiguration(base, overlay) {
  const errors = validateReleaseConfiguration({ ...base, version: overlay.version }, overlay);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.[1-9]\d*$/.test(overlay.version ?? "")) {
    errors.push("An explicit preview SemVer such as 0.1.1-preview.1 is required.");
  }
  if (overlay.bundle?.macOS?.signingIdentity !== "-") errors.push("Preview builds require ad hoc signing.");
  if (overlay.plugins?.updater?.endpoints?.[0] !== PREVIEW_ENDPOINT) errors.push("Preview builds must use the dedicated preview feed in emixd12/cadence.");
  return errors;
}

export function validatePreviewBuildEnvironment(env) {
  const errors = [];
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) errors.push("TAURI_SIGNING_PRIVATE_KEY is required to sign preview updater artifacts.");
  if (env.TAURI_CONFIG) errors.push("Unset TAURI_CONFIG; preview configuration comes from the reviewed preview overlay.");
  errors.push(...validateDesktopPublicSupabaseEnvironment(env));
  return errors;
}

export function validateDesktopPublicSupabaseEnvironment(env) {
  const errors = [];
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
  } catch { errors.push("VITE_SUPABASE_URL must be a valid public HTTPS URL."); }
  if (!isPublicSupabaseKey(key)) errors.push("VITE_SUPABASE_PUBLISHABLE_KEY or legacy VITE_SUPABASE_ANON_KEY must contain a public Supabase key.");
  return errors;
}

function isPublicSupabaseKey(value) {
  if (!value || /^(?:sb_secret_|sbp_)/.test(value)) return false;
  if (value.startsWith("sb_publishable_")) return value.length > "sb_publishable_".length;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "anon"; }
  catch { return false; }
}

export function decodeUpdaterPublicKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) throw new Error("CADENCE_UPDATER_PUBLIC_KEY must contain the Tauri public key, not a path.");
  const bytes = Buffer.from(value.trim(), "base64");
  const decoded = bytes.toString("utf8");
  if (bytes.toString("base64") !== value.trim() || !Buffer.from(decoded, "utf8").equals(bytes)) throw new Error("CADENCE_UPDATER_PUBLIC_KEY must use canonical base64 and valid UTF-8.");
  const lines = decoded.trim().split(/\r?\n/);
  const key = Buffer.from(lines[1] ?? "", "base64");
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment:") || key.length !== 42 || key.subarray(0, 2).toString() !== "Ed"
    || key.toString("base64") !== lines[1]) throw new Error("CADENCE_UPDATER_PUBLIC_KEY is not a Tauri Minisign public key.");
  return decoded;
}

export function validateReleaseConfiguration(base, overlay) {
  const errors = [];
  if (overlay.identifier !== RELEASE_IDENTIFIER || overlay.productName !== RELEASE_NAME) errors.push("Release identity must be Cadence / app.cadence.desktop.");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(base.version ?? "")) errors.push("The native version must be a SemVer version.");
  if (base.bundle?.macOS?.minimumSystemVersion !== "14.0" || base.bundle?.macOS?.hardenedRuntime !== true) errors.push("Release builds require macOS 14.0 minimum and hardened runtime.");
  if (overlay.bundle?.createUpdaterArtifacts !== true || !["app", "dmg"].every((target) => overlay.bundle?.targets?.includes(target))) errors.push("Release builds require signed updater artifacts, app and DMG targets.");
  const updater = overlay.plugins?.updater;
  try { decodeUpdaterPublicKey(updater?.pubkey); } catch (error) { errors.push(error.message); }
  if (!["dangerousInsecureTransportProtocol", "dangerousAcceptInvalidCerts", "dangerousAcceptInvalidHostnames"].every((flag) => updater?.[flag] === undefined || updater[flag] === false)) errors.push("Updater transport and certificate validation cannot be disabled.");
  if (!Array.isArray(updater?.endpoints) || updater.endpoints.length !== 1 || !isReleaseUrl(updater.endpoints[0])) errors.push("CADENCE_UPDATER_ENDPOINT must be the owner's public HTTPS feed URL, without credentials or placeholders.");
  return errors;
}

export function isReleaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      && url.hostname.includes(".") && !/^(localhost|127\.|0\.)/.test(url.hostname)
      && !/(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/.test(url.hostname);
  } catch { return false; }
}

export function validateSigningEnvironment(env) {
  const errors = validateDesktopPublicSupabaseEnvironment(env);
  if (!env.APPLE_SIGNING_IDENTITY?.startsWith("Developer ID Application:")) errors.push("APPLE_SIGNING_IDENTITY must select a valid Developer ID Application certificate.");
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) errors.push("TAURI_SIGNING_PRIVATE_KEY is required; production keys are never generated by this script.");
  const appleId = env.APPLE_ID && env.APPLE_PASSWORD && env.APPLE_TEAM_ID;
  const apiKey = env.APPLE_API_ISSUER && env.APPLE_API_KEY && env.APPLE_API_KEY_PATH;
  if (!appleId && !apiKey) errors.push("Set one complete Apple notarization credential set: APPLE_ID/PASSWORD/TEAM_ID or APPLE_API_ISSUER/KEY/KEY_PATH.");
  if (env.TAURI_CONFIG) errors.push("Unset TAURI_CONFIG; release configuration comes from the reviewed release overlay.");
  return errors;
}
