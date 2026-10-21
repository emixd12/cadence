import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopUpdateSection } from "../apps/desktop/src/desktop-update-panel";
import type { DesktopUpdateState } from "../apps/desktop/src/desktop-updater";
import { shouldRetryAccountSync, syncFailureStatus } from "../apps/desktop/src/sync-engine";

function markup(state: Partial<DesktopUpdateState>, restartBlocked = false, restartError?: string) {
  return renderToStaticMarkup(<DesktopUpdateSection state={{ phase: "idle", automaticDownloads: true, ...state }}
    onCheck={vi.fn()} onAutomaticDownloads={vi.fn()} onDownload={vi.fn()} onInstall={vi.fn()} onRetry={vi.fn()}
    onRestart={vi.fn()} onDiscardAndRestart={vi.fn()} onCancelRestart={vi.fn()} restartBlocked={restartBlocked} restartError={restartError} />);
}

describe("desktop update actions", () => {
  it("exposes only the next explicit install action after download", () => {
    expect(markup({ phase: "available" })).toContain("Download update");
    expect(markup({ phase: "available" })).not.toContain(">Install update<");
    expect(markup({ phase: "downloaded", version: "0.2.0" })).toContain(">Install update<");
    expect(markup({ phase: "downloaded" })).not.toContain(">Restart Cadence<");
    expect(markup({ phase: "installed" })).toContain(">Restart Cadence<");
  });
  it("reports bounded progress and plain-text release notes", () => {
    const html = markup({ phase: "downloading", version: "0.2.0", downloadedBytes: 150, totalBytes: 100, notes: "<script>alert(1)</script>" });
    expect(html).toContain('value="100"');
    expect(html).toContain('aria-label="Update download progress"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("requires explicit discard or continued editing for unsaved drafts", () => {
    const html = markup({ phase: "installed" }, true);
    expect(html).toContain("Discard drafts and restart");
    expect(html).toContain("Keep editing");
  });
  it("shows a refused restart beside the Restart button", () => {
    const message = "Cadence is still saving or synchronizing. Try Restart again in a moment, or quit and reopen Cadence to finish the update.";
    const html = markup({ phase: "installed" }, false, message);
    expect(html).toContain(message);
    expect(html.indexOf(message)).toBeGreaterThan(html.indexOf(">Restart Cadence<"));
    expect(html).toContain('role="alert"');
    expect(markup({ phase: "current" }, false, message)).not.toContain(message);
  });
  it.each(["category", "Behavior"])("recognizes the exact %s compatibility response", (kind) => {
    const status = syncFailureStatus({ code: "22023", message: `Update Cadence before synchronizing ${kind} changes.` });
    expect(status).toEqual({ state: "update_required", message: "Update required to synchronize" });
    expect(shouldRetryAccountSync(status, 0)).toBe(false);
  });
  it("does not turn ordinary failures into update prompts", () => {
    for (const error of [
      { code: "22023", message: "Invalid input" },
      { code: "42501", message: "Update Cadence before synchronizing Behavior changes." },
      new TypeError("Network fetch failed"), { code: "401", message: "Unauthorized" },
      { message: "Conflict" },
    ]) expect(syncFailureStatus(error).state).not.toBe("update_required");
  });
});
