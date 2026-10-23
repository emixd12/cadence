import { useState } from "react";
import { DesktopApp } from "./desktop-app";
import { DesktopUpdateSection } from "./desktop-update-panel";
import type { DesktopUpdateState } from "./desktop-updater";
import { LocalDatabaseSection } from "./local-database-controls";
import { ConnectorLibraryBench } from "@/app/design-system/ConnectorBench";

export function SettingsBench() {
  const [accountName, setAccountName] = useState("Cadence User");
  const [phase, setPhase] = useState<DesktopUpdateState["phase"]>("downloaded");
  const [automaticDownloads, setAutomaticDownloads] = useState(true);
  const [restartBlocked, setRestartBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const usage = { databaseBytes: 250000, walBytes: 4096, shmBytes: 32768, recoveryBytes: 6000000000, totalBytes: 6000286864 };
  return <DesktopApp activeScreen="settings" availableScreens={["timeline", "behaviors", "export", "settings"]}
    account={accountName ? { status: "linked", userId: "fixture", email: "owner@example.test", name: accountName } : { status: "local" }}
    onNavigate={(screen) => setMessage(`Fixture navigation: ${screen}`)}><main className="mx-auto max-w-3xl px-4 py-8">
    <h1 className="text-2xl">Desktop Settings fixtures</h1>
    <p className="mt-3 text-sm">Synthetic controls. These fixtures do not invoke native updates or change files.</p>
    <label className="mt-4 block">Account name (empty for local mode)
      <input className="mt-2 block w-full border border-line px-3 py-2" value={accountName} onChange={(event) => setAccountName(event.currentTarget.value)} />
    </label>
    <label className="mt-4 flex min-h-11 items-center gap-3">Update state
      <select value={phase} onChange={(event) => setPhase(event.currentTarget.value as DesktopUpdateState["phase"])}>
        {["unavailable", "idle", "checking", "current", "available", "downloading", "downloaded", "installing", "installed", "error"].map((value) => <option key={value}>{value}</option>)}
      </select>
    </label>
    <DesktopUpdateSection state={{ phase, automaticDownloads, currentVersion: "0.1.1", version: "0.1.2", notes: "Storage recovery and dependency-safe account synchronization.", downloadedBytes: 50, totalBytes: 100,
      error: phase === "error" ? "The update could not be downloaded. Try again." : undefined }}
      onCheck={() => setPhase("available")} onAutomaticDownloads={setAutomaticDownloads} onDownload={() => setPhase("downloaded")}
      onInstall={() => setPhase("installed")} onRetry={() => setPhase("downloaded")} onRestart={() => setRestartBlocked(true)}
      restartBlocked={restartBlocked} onCancelRestart={() => setRestartBlocked(false)} onDiscardAndRestart={() => { setRestartBlocked(false); setMessage("Fixture restart requested."); }} />
    <div id="connector-library-bench" className="mt-8 border-t border-line pt-6"><ConnectorLibraryBench /></div>
    <LocalDatabaseSection info={{ path: "/Users/fixture/Library/Application Support/app.cadence.desktop/cadence.sqlite3", localMode: false,
      recovery: { state: "reopen_verified", backupPath: "/Users/fixture/Library/Application Support/app.cadence.desktop/Backups/.cadence-protected-storage-recovery.sqlite3", before: usage, after: usage } }}
      confirmation="" busy={false} message={message} onConfirmationChange={() => {}} onReveal={() => setMessage("Fixture reveal requested.")}
      onBackup={() => setMessage("Fixture backup requested.")} onRestore={() => {}} onDeleteRecoveryBackup={() => setMessage("Fixture backup deletion requested.")} />
  </main></DesktopApp>;
}
