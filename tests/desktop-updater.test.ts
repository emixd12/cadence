import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_UPDATE_CHECK_INTERVAL_MS,
  createDesktopUpdater,
  type DesktopUpdate,
  type DesktopUpdateStorage,
  type DesktopUpdateTransport,
} from "../apps/desktop/src/desktop-updater";

function storage(values: Record<string, string> = {}) {
  const valuesByKey = new Map(Object.entries(values));
  return {
    getItem: (key: string) => valuesByKey.get(key) ?? null,
    setItem: (key: string, value: string) => { valuesByKey.set(key, value); },
  } satisfies DesktopUpdateStorage;
}

function update(version = "0.2.0") {
  return {
    version,
    body: "Fixes local storage.",
    download: vi.fn(async (onEvent) => {
      onEvent({ event: "started", contentLength: 10 });
      onEvent({ event: "progress", chunkLength: 4 });
      onEvent({ event: "progress", chunkLength: 6 });
      onEvent({ event: "finished" });
    }),
    install: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies DesktopUpdate;
}

function fixture(options: { configured?: boolean; now?: number; storage?: DesktopUpdateStorage; update?: DesktopUpdate | null } = {}) {
  let currentTime = options.now ?? DESKTOP_UPDATE_CHECK_INTERVAL_MS;
  const candidate = options.update === undefined ? update() : options.update;
  const transport: DesktopUpdateTransport = {
    configuration: vi.fn(async () => ({ configured: options.configured ?? true, version: "0.1.0" })),
    check: vi.fn(async () => candidate),
    restart: vi.fn(async () => {}),
  };
  const controller = createDesktopUpdater(transport, {
    now: () => currentTime,
    storage: options.storage ?? storage(),
  });
  return { candidate, controller, setTime: (next: number) => { currentTime = next; }, transport };
}

describe("desktop updater controller", () => {
  it("keeps initialization local and checks an overdue startup once", async () => {
    const { candidate, controller, transport } = fixture({ now: 1 });
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", automaticDownloads: true });
    expect(transport.check).not.toHaveBeenCalled();

    await controller.checkOverdue();
    expect(transport.check).toHaveBeenCalledOnce();
    expect(candidate?.download).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", downloadedBytes: 10, totalBytes: 10, lastAttemptAt: 1 });
    await controller.checkOverdue();
    expect(transport.check).toHaveBeenCalledOnce();
  });

  it("persists an enabled-by-default automatic-download preference and retains manual downloads when disabled", async () => {
    const saved = storage({ "cadence.desktop-updater.automatic-downloads": "false" });
    const { candidate, controller, transport } = fixture({ storage: saved });
    await controller.initialize();
    expect(controller.getSnapshot().automaticDownloads).toBe(false);
    await controller.checkOverdue();
    expect(transport.check).toHaveBeenCalledOnce();
    expect(candidate?.download).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("available");
    await controller.download();
    expect(controller.getSnapshot().phase).toBe("downloaded");

    controller.setAutomaticDownloads(true);
    expect(saved.getItem("cadence.desktop-updater.automatic-downloads")).toBe("true");
  });

  it("lets a manual check bypass the persisted 24-hour interval", async () => {
    const saved = storage({ "cadence.desktop-updater.last-attempt": String(DESKTOP_UPDATE_CHECK_INTERVAL_MS) });
    const { controller, transport } = fixture({ now: DESKTOP_UPDATE_CHECK_INTERVAL_MS + 1, storage: saved, update: null });
    await controller.initialize();
    await controller.checkOverdue();
    expect(transport.check).not.toHaveBeenCalled();
    await controller.check();
    expect(transport.check).toHaveBeenCalledOnce();
  });

  it("downloads a newer release found by a manual check when automatic downloads are enabled", async () => {
    const { candidate, controller } = fixture();
    await controller.initialize();
    await controller.check();
    expect(candidate!.download).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe("downloaded");
  });

  it("refreshes an overdue candidate and releases the superseded resource", async () => {
    const first = update("0.2.0");
    const second = update("0.3.0");
    const { controller, setTime, transport } = fixture({ now: 1, update: first });
    await controller.initialize();
    await controller.checkOverdue();
    vi.mocked(transport.check).mockResolvedValueOnce(second);
    setTime(DESKTOP_UPDATE_CHECK_INTERVAL_MS + 1);
    await controller.checkOverdue();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.download).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", version: "0.3.0", snoozed: false });
  });

  it("retains a downloaded candidate when discovery returns the same release or fails", async () => {
    const first = update();
    const duplicate = update();
    const { controller, transport, setTime } = fixture({ now: 1, update: first });
    await controller.check();
    controller.later();
    vi.mocked(transport.check).mockResolvedValueOnce(duplicate);
    setTime(DESKTOP_UPDATE_CHECK_INTERVAL_MS + 1);
    await controller.checkOverdue();
    expect(duplicate.close).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    expect(first.download).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", snoozed: false });
    vi.mocked(transport.check).mockRejectedValueOnce(new Error("offline"));
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", version: first.version });
    await controller.install();
    expect(first.install).toHaveBeenCalledOnce();
  });

  it("does not register overdue checks after stop cancels a pending startup", async () => {
    vi.useFakeTimers();
    let resolveConfiguration!: () => void;
    const transport: DesktopUpdateTransport = {
      configuration: vi.fn(() => new Promise<{ configured: boolean; version: string }>((resolve) => { resolveConfiguration = () => resolve({ configured: true, version: "0.1.0" }); })),
      check: vi.fn(async () => null),
      restart: vi.fn(async () => {}),
    };
    const controller = createDesktopUpdater(transport, { storage: storage() });
    const starting = controller.start();
    controller.stop();
    resolveConfiguration();
    await starting;
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_CHECK_INTERVAL_MS);
    expect(transport.check).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("retries an offline discovery failure without treating it as an installed update", async () => {
    const { controller, transport } = fixture();
    vi.mocked(transport.check).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
    await controller.initialize();
    await controller.checkOverdue();
    expect(controller.getSnapshot().phase).toBe("error");
    await controller.retry();
    expect(controller.getSnapshot().phase).toBe("current");
    expect(transport.check).toHaveBeenCalledTimes(2);
  });

  it("keeps signature or download rejection separate from installation and supports retry", async () => {
    const { candidate, controller } = fixture();
    vi.mocked(candidate!.download).mockRejectedValueOnce(new Error("invalid signature"));
    await controller.initialize();
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("error");
    await controller.install();
    expect(candidate!.install).not.toHaveBeenCalled();
    await controller.retry();
    expect(controller.getSnapshot().phase).toBe("downloaded");
    expect(candidate!.download).toHaveBeenCalledTimes(2);
  });

  it("retries an interrupted download from zero without exposing a partial candidate for installation", async () => {
    const { candidate, controller, transport } = fixture();
    let interrupt!: () => void;
    vi.mocked(candidate!.download).mockImplementationOnce((onEvent) => new Promise<void>((_resolve, reject) => {
      onEvent({ event: "started", contentLength: 10 });
      onEvent({ event: "progress", chunkLength: 4 });
      interrupt = () => reject(new Error("connection closed during download"));
    }));
    const downloading = controller.check();
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ phase: "downloading", downloadedBytes: 4, totalBytes: 10 }));
    await controller.install();
    await controller.retry();
    expect(candidate!.install).not.toHaveBeenCalled();
    expect(candidate!.download).toHaveBeenCalledOnce();

    interrupt();
    await downloading;
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", version: candidate!.version });
    await controller.install();
    expect(candidate!.install).not.toHaveBeenCalled();

    const progress: number[] = [];
    const unsubscribe = controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.phase === "downloading") progress.push(state.downloadedBytes!);
    });
    await controller.retry();
    unsubscribe();
    expect(progress).toEqual([0, 0, 4, 10]);
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", downloadedBytes: 10, totalBytes: 10 });
    expect(candidate!.download).toHaveBeenCalledTimes(2);
    expect(candidate!.close).not.toHaveBeenCalled();
    expect(candidate!.install).not.toHaveBeenCalled();
    expect(transport.check).toHaveBeenCalledOnce();
    expect(transport.restart).not.toHaveBeenCalled();
  });

  it("does not report installation after an install failure and releases only after success", async () => {
    const { candidate, controller } = fixture();
    vi.mocked(candidate!.install).mockRejectedValueOnce(new Error("install failed"));
    await controller.initialize();
    await controller.check();
    await controller.download();
    await controller.install();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(candidate!.close).not.toHaveBeenCalled();
    await controller.retry();
    expect(controller.getSnapshot().phase).toBe("installed");
    expect(candidate!.close).toHaveBeenCalledOnce();
  });

  it("snoozes one release for 24 hours while retaining its candidate across navigation", async () => {
    const saved = storage();
    const first = update("0.2.0");
    const second = update("0.3.0");
    const { controller, setTime, transport } = fixture({ storage: saved, update: first });
    await controller.initialize();
    await controller.check();
    controller.later();
    expect(controller.getSnapshot().snoozed).toBe(true);
    expect(first.close).not.toHaveBeenCalled();

    vi.mocked(transport.check).mockResolvedValueOnce(second);
    setTime(DESKTOP_UPDATE_CHECK_INTERVAL_MS + 2);
    await controller.check();
    expect(first.close).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: "downloaded", version: "0.3.0", snoozed: false });
  });

  it("ends Later exactly 24 hours after the choice without requiring another feed check", async () => {
    vi.useFakeTimers();
    try {
      const { controller, transport, setTime } = fixture({ now: 1 });
      await controller.check();
      setTime(6 * 60 * 60 * 1000);
      controller.later();
      await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_CHECK_INTERVAL_MS);
      expect(controller.getSnapshot().snoozed).toBe(false);
      expect(transport.check).toHaveBeenCalledOnce();
      controller.stop();
    } finally { vi.useRealTimers(); }
  });

  it("keeps restart separate and lets the shell guard drafts before native restart", async () => {
    const { candidate, controller, transport } = fixture();
    await controller.initialize();
    await controller.check();
    await controller.download();
    await controller.install();
    controller.setRestartGuard(async () => false);
    await controller.restart();
    expect(transport.restart).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBe("Save or discard your changes before restarting Cadence.");
    controller.setRestartGuard(() => true);
    await controller.restart();
    expect(transport.restart).toHaveBeenCalledOnce();
    expect(candidate!.install).toHaveBeenCalledOnce();
  });

  it("serializes install and discovery, and preserves installed state after restart failure", async () => {
    const { controller, transport, candidate } = fixture();
    await controller.check();
    let finish!: () => void;
    vi.mocked(candidate!.install).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const installing = controller.install();
    await controller.install();
    await controller.check();
    await controller.restart();
    expect(candidate!.install).toHaveBeenCalledOnce();
    expect(candidate!.close).not.toHaveBeenCalled();
    expect(transport.check).toHaveBeenCalledOnce();
    finish();
    await installing;
    vi.mocked(transport.restart).mockRejectedValueOnce(new Error("restart failed"));
    await controller.restart();
    expect(controller.getSnapshot()).toMatchObject({ phase: "installed", error: "Cadence could not restart. Quit and reopen Cadence to finish the update." });
  });

  it("checks when an overdue webview becomes visible without focus and removes the listener on stop", async () => {
    const visibility = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", visibility);
    const { controller, transport, setTime } = fixture({ now: 1, update: null });
    try {
      await controller.start();
      setTime(DESKTOP_UPDATE_CHECK_INTERVAL_MS + 1);
      visibility.hidden = true;
      visibility.dispatchEvent(new Event("visibilitychange"));
      expect(transport.check).toHaveBeenCalledOnce();
      visibility.hidden = false;
      visibility.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(transport.check).toHaveBeenCalledTimes(2));
      controller.stop();
      setTime(2 * DESKTOP_UPDATE_CHECK_INTERVAL_MS + 1);
      visibility.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      expect(transport.check).toHaveBeenCalledTimes(2);
    } finally { controller.stop(); vi.unstubAllGlobals(); }
  });

  it("does not contact an unconfigured updater build", async () => {
    const { controller, transport } = fixture({ configured: false });
    await controller.initialize();
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("unavailable");
    expect(transport.check).not.toHaveBeenCalled();
  });
});
