export const RELEASE_IDENTIFIER: "app.cadence.desktop";
export const RELEASE_NAME: "Cadence";
export const RELEASE_TARGET: "aarch64-apple-darwin";
export const PREVIEW_ENDPOINT: "https://github.com/emixd12/cadence/releases/download/desktop-preview/latest.json";
export const UPDATER_QA_ENDPOINT: "https://github.com/emixd12/cadence/releases/download/desktop-updater-qa-20260928/latest.json";
export function createReleaseBuildEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined>;
export function createPreviewBuildEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined>;
export type ReleaseOverlay = {
  productName: string;
  identifier: string;
  app: { windows: Record<string, unknown>[] };
  bundle: { targets: string[]; createUpdaterArtifacts: boolean; macOS: {
    entitlements?: string; files?: Record<string, string>;
  } };
  plugins: { updater: {
    pubkey: string;
    endpoints: string[];
    dangerousInsecureTransportProtocol: boolean;
    dangerousAcceptInvalidCerts: boolean;
    dangerousAcceptInvalidHostnames: boolean;
  } };
};
export function createReleaseOverlay(base: { app: { windows: Record<string, unknown>[] } }, env: Record<string, string | undefined>): ReleaseOverlay;
export type PreviewOverlay = ReleaseOverlay & { version: string; bundle: ReleaseOverlay["bundle"] & {
  macOS: { signingIdentity: string; minimumSystemVersion: string; hardenedRuntime: boolean };
} };
export function createPreviewOverlay(base: { app: { windows: Record<string, unknown>[] } }, env: Record<string, string | undefined>, version: string): PreviewOverlay;
export function validatePreviewConfiguration(base: unknown, overlay: unknown): string[];
export function validatePreviewBuildEnvironment(env: Record<string, string | undefined>): string[];
export function validateDesktopPublicServiceEnvironment(env: Record<string, string | undefined>, base?: unknown): string[];
export function decodeUpdaterPublicKey(value: unknown): string;
export function validateReleaseConfiguration(base: unknown, overlay: unknown): string[];
export function isReleaseUrl(value: string): boolean;
export function validateSigningEnvironment(env: Record<string, string | undefined>, base?: unknown): string[];
