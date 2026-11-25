import { getLocalStorage } from "@/lib/ui/browser-storage";

export const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const AUTOMATIC_DOWNLOADS_KEY = "cadence.desktop-updater.automatic-downloads";
const LAST_ATTEMPT_KEY = "cadence.desktop-updater.last-attempt";
const SNOOZE_KEY = "cadence.desktop-updater.snooze";

export type DesktopUpdateDownloadEvent =
  | Readonly<{ event: "started"; contentLength?: number }>
  | Readonly<{ event: "progress"; chunkLength: number }>
  | Readonly<{ event: "finished" }>;

export type DesktopUpdate = Readonly<{
  version: string;
  body?: string;
  download: (onEvent: (event: DesktopUpdateDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}>;

export type DesktopUpdateTransport = Readonly<{
  configuration: () => Promise<{ configured: boolean; version: string }>;
  check: () => Promise<DesktopUpdate | null>;
  restart: () => Promise<void>;
}>;

export type DesktopUpdateStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export type DesktopUpdateState = Readonly<{
  phase: "loading" | "unavailable" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "installing" | "installed" | "error";
  automaticDownloads: boolean;
  currentVersion?: string;
  version?: string;
  notes?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  lastAttemptAt?: number;
  snoozed?: boolean;
  error?: string;
}>;

type RetryAction = "check" | "download" | "install" | undefined;
type RestartGuard = () => boolean | Promise<boolean>;

export type DesktopUpdaterDependencies = Readonly<{
  now?: () => number;
  storage?: DesktopUpdateStorage;
  checkIntervalMs?: number;
}>;

const memoryStorage = new Map<string, string>();

function browserStorage(): DesktopUpdateStorage {
  const storage = getLocalStorage();
  if (storage) return storage;
  // The test and non-browser fallback.
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => { memoryStorage.set(key, value); },
  };
}

function read(storage: DesktopUpdateStorage, key: string) {
  try { return storage.getItem(key); } catch { return null; }
}

function write(storage: DesktopUpdateStorage, key: string, value: string) {
  try { storage.setItem(key, value); } catch { /* Local tracking remains available when browser storage is unavailable. */ }
}

function readTimestamp(storage: DesktopUpdateStorage, key: string) {
  const value = Number(read(storage, key));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function snoozed(storage: DesktopUpdateStorage, version: string, now: number) {
  try {
    const value = JSON.parse(read(storage, SNOOZE_KEY) ?? "null") as { version?: unknown; until?: unknown } | null;
    return value?.version === version && typeof value.until === "number" && value.until > now;
  } catch { return false; }
}

/** One app-lifetime controller retains one signed candidate across screen navigation. */
export function createDesktopUpdater(transport: DesktopUpdateTransport, dependencies: DesktopUpdaterDependencies = {}) {
  const storage = dependencies.storage ?? browserStorage();
  const now = dependencies.now ?? Date.now;
  const checkIntervalMs = dependencies.checkIntervalMs ?? DESKTOP_UPDATE_CHECK_INTERVAL_MS;
  let state: DesktopUpdateState = { phase: "loading", automaticDownloads: true };
  let initialization: Promise<void> | undefined;
  let startup: Promise<void> | undefined;
  let configured = false;
  let busy = false;
  let candidate: DesktopUpdate | null = null;
  let retryAction: RetryAction;
  let restartGuard: RestartGuard | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lifecycleGeneration = 0;
  let snoozeTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: DesktopUpdateState) => {
    state = next;
    if (snoozeTimer) clearTimeout(snoozeTimer);
    snoozeTimer = undefined;
    if (state.snoozed && state.version) {
      try {
        const until = JSON.parse(read(storage, SNOOZE_KEY) ?? "null")?.until;
        if (typeof until === "number" && Number.isFinite(until)) {
          snoozeTimer = setTimeout(() => publish({ ...state, snoozed: false }), Math.min(DESKTOP_UPDATE_CHECK_INTERVAL_MS, Math.max(0, until - now())));
        }
      } catch { /* A malformed snooze cannot prevent update review. */ }
    }
    for (const listener of listeners) listener();
  };
  const shared = () => ({
    currentVersion: state.currentVersion,
    automaticDownloads: state.automaticDownloads,
    lastAttemptAt: state.lastAttemptAt,
  });
  const release = async () => {
    const previous = candidate;
    candidate = null;
    if (previous) await previous.close().catch(() => {});
  };
  const checkWhenOverdue = () => { void check(true); };
  const visibilityChanged = () => {
    if (typeof document !== "undefined" && !document.hidden) void check(true);
  };
  const check = async (automatic: boolean) => {
    await initialize();
    if (!configured || busy || state.phase === "installed") return;
    const attemptedAt = now();
    if (automatic && state.lastAttemptAt !== undefined && state.lastAttemptAt + checkIntervalMs > attemptedAt) return;
    const previous = candidate;
    const previousState = state;
    const previousRetryAction = retryAction;
    busy = true;
    write(storage, LAST_ATTEMPT_KEY, String(attemptedAt));
    publish({ ...shared(), phase: "checking", lastAttemptAt: attemptedAt });
    try {
      const next = await transport.check();
      if (previous && next && previous.version === next.version) {
        if (next !== previous) await next.close().catch(() => {});
        candidate = previous;
        const retainedInstallFailure = previousState.phase === "error" && previousRetryAction === "install";
        retryAction = retainedInstallFailure ? "install" : undefined;
        publish({
          ...shared(),
          phase: retainedInstallFailure ? "error" : previousState.phase === "downloaded" ? "downloaded" : "available",
          version: previous.version,
          notes: previous.body,
          downloadedBytes: previousState.downloadedBytes,
          totalBytes: previousState.totalBytes,
          snoozed: snoozed(storage, previous.version, now()),
          error: retainedInstallFailure ? previousState.error : undefined,
        });
        if (state.automaticDownloads && !retainedInstallFailure && previousState.phase !== "downloaded") await download(true);
        return;
      }
      if (previous) await previous.close().catch(() => {});
      candidate = next;
      retryAction = undefined;
      if (!candidate) {
        publish({ ...shared(), phase: "current" });
        return;
      }
      publish({
        ...shared(),
        phase: "available",
        version: candidate.version,
        notes: candidate.body,
        snoozed: snoozed(storage, candidate.version, now()),
      });
      if (state.automaticDownloads) await download(true);
    } catch {
      retryAction = previous ? previousRetryAction : "check";
      publish({ ...(previous ? previousState : {}), ...shared(), phase: previous ? previousState.phase : "error",
        snoozed: previous ? snoozed(storage, previous.version, now()) : undefined,
        error: "Cadence could not check for updates. Check your connection and try again." });
    } finally { busy = false; }
  };
  const download = async (continuation = false) => {
    if ((!continuation && busy) || !candidate || (state.phase !== "available" && !(state.phase === "error" && retryAction === "download"))) return;
    if (!continuation) busy = true;
    retryAction = undefined;
    let downloadedBytes = 0;
    publish({ ...shared(), phase: "downloading", version: candidate.version, notes: candidate.body, snoozed: state.snoozed, downloadedBytes });
    try {
      await candidate.download((event) => {
        if (event.event === "started") {
          publish({ ...shared(), phase: "downloading", version: candidate?.version, notes: candidate?.body, snoozed: state.snoozed, downloadedBytes, totalBytes: event.contentLength });
        } else if (event.event === "progress") {
          downloadedBytes += event.chunkLength;
          publish({ ...shared(), phase: "downloading", version: candidate?.version, notes: candidate?.body, snoozed: state.snoozed, downloadedBytes, totalBytes: state.totalBytes });
        }
      });
      publish({ ...shared(), phase: "downloaded", version: candidate.version, notes: candidate.body, snoozed: state.snoozed, downloadedBytes, totalBytes: state.totalBytes });
    } catch {
      retryAction = "download";
      publish({ ...shared(), phase: "error", version: candidate.version, notes: candidate.body, snoozed: state.snoozed, error: "Cadence could not download the update. Check your connection and try again." });
    } finally { if (!continuation) busy = false; }
  };
  const initialize = () => {
    initialization ??= (async () => {
      const automaticDownloads = read(storage, AUTOMATIC_DOWNLOADS_KEY) !== "false";
      const lastAttemptAt = readTimestamp(storage, LAST_ATTEMPT_KEY);
      try {
        const configuration = await transport.configuration();
        configured = configuration.configured;
        publish({ phase: configured ? "idle" : "unavailable", automaticDownloads, currentVersion: configuration.version, lastAttemptAt });
      } catch {
        publish({ phase: "unavailable", automaticDownloads, lastAttemptAt });
      }
    })();
    return initialization;
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    initialize,
    start() {
      if (startup) return startup;
      const generation = ++lifecycleGeneration;
      startup = (async () => {
        await initialize();
        if (generation !== lifecycleGeneration) return;
        publish({ ...state });
        await check(true);
        if (generation !== lifecycleGeneration) return;
        interval = setInterval(() => { void check(true); }, checkIntervalMs);
        globalThis.addEventListener?.("online", checkWhenOverdue);
        globalThis.addEventListener?.("focus", checkWhenOverdue);
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityChanged);
      })();
      return startup;
    },
    stop() {
      lifecycleGeneration += 1;
      if (interval) clearInterval(interval);
      if (snoozeTimer) clearTimeout(snoozeTimer);
      snoozeTimer = undefined;
      interval = undefined;
      globalThis.removeEventListener?.("online", checkWhenOverdue);
      globalThis.removeEventListener?.("focus", checkWhenOverdue);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityChanged);
      startup = undefined;
    },
    checkOverdue: () => check(true),
    check: () => check(false),
    setAutomaticDownloads(automaticDownloads: boolean) {
      write(storage, AUTOMATIC_DOWNLOADS_KEY, String(automaticDownloads));
      publish({ ...state, automaticDownloads });
    },
    async download() { await download(); },
    async install() {
      if (busy || !candidate || (state.phase !== "downloaded" && !(state.phase === "error" && retryAction === "install"))) return;
      busy = true;
      retryAction = undefined;
      publish({ ...shared(), phase: "installing", version: candidate.version, notes: candidate.body, snoozed: state.snoozed });
      try {
        await candidate.install();
        await release();
        publish({ ...shared(), phase: "installed" });
      } catch {
        retryAction = "install";
        publish({ ...shared(), phase: "error", version: candidate.version, notes: candidate.body, snoozed: state.snoozed, error: "Cadence could not confirm the update was installed. Check for updates to retry." });
      } finally { busy = false; }
    },
    async retry() {
      if (retryAction === "download") await download();
      else if (retryAction === "install") await this.install();
      else if (retryAction === "check") await check(false);
    },
    later() {
      if (!candidate || (state.phase !== "available" && state.phase !== "downloaded")) return;
      write(storage, SNOOZE_KEY, JSON.stringify({ version: candidate.version, until: now() + DESKTOP_UPDATE_CHECK_INTERVAL_MS }));
      publish({ ...state, snoozed: true });
    },
    setRestartGuard(guard: RestartGuard | undefined) { restartGuard = guard; },
    async restart() {
      if (busy || state.phase !== "installed") return;
      busy = true;
      try {
        if (restartGuard && !await restartGuard()) {
          publish({ ...state, error: "Save or discard your changes before restarting Cadence." });
          return;
        }
        await transport.restart();
      } catch {
        publish({ ...state, error: "Cadence could not restart. Quit and reopen Cadence to finish the update." });
      } finally { busy = false; }
    },
  };
}
