import { useEffect, useState } from "react";
import { backupLocalDatabase, deleteStorageRecoveryBackup, readLocalDatabaseInfo, restoreLocalDatabase, revealLocalDatabase, type LocalDatabaseInfo } from "./local-database";
import { localErrorMessage } from "./local-actions";
import { SettingsPartHeading, SettingsSectionHeading } from "@/components/settings/settings-heading";

export function LocalDatabaseControls({ onRestored }: Readonly<{ onRestored: () => void }>) {
  const [info, setInfo] = useState<LocalDatabaseInfo | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void readLocalDatabaseInfo().then(setInfo).catch((error) => setMessage(localErrorMessage(error))); }, []);
  const run = async (action: () => Promise<string>) => {
    setBusy(true); setMessage("");
    try { setMessage(await action()); } catch (error) { setMessage(localErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <LocalDatabaseSection info={info} confirmation={confirmation} busy={busy} message={message}
    onConfirmationChange={setConfirmation}
    onDeleteRecoveryBackup={() => void run(async () => { const recovery = await deleteStorageRecoveryBackup(); setInfo((value) => value ? { ...value, recovery } : value); return "Recovery backup deleted. User-created backups remain unchanged."; })}
    onReveal={() => void run(async () => { await revealLocalDatabase(); return "Opened the database location in Finder."; })}
    onBackup={() => void run(async () => await backupLocalDatabase() ? "Backup saved." : "Backup cancelled.")}
    onRestore={() => void run(async () => { const protectedPath = await restoreLocalDatabase(confirmation); if (!protectedPath) return "Restore cancelled."; setConfirmation(""); onRestored(); return `Restore complete. The prior database is protected at ${protectedPath}`; })} />;
}

export function LocalDatabaseSection({ info, confirmation, busy, message, onConfirmationChange, onReveal, onBackup, onRestore, onDeleteRecoveryBackup }: Readonly<{
  info: LocalDatabaseInfo | null; confirmation: string; busy: boolean; message: string;
  onDeleteRecoveryBackup?: () => void;
  onConfirmationChange: (value: string) => void; onReveal: () => void; onBackup: () => void; onRestore: () => void;
}>) {
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  return <section id="local-database" aria-busy={busy} className="bg-background py-4">
    <SettingsSectionHeading>Local database</SettingsSectionHeading>
    <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">Cadence stores the live database in its macOS Application Support folder.</p>
    <dl className="mt-4 text-sm leading-6"><div><dt>Exact path</dt><dd className="break-all text-muted-readable">{info?.path ?? "Loading…"}</dd></div></dl>
    {info?.recovery?.after ? <div className="mt-4 text-sm leading-6">
      <SettingsPartHeading className="text-base">Storage recovery</SettingsPartHeading>
      <dl className="mt-2 grid gap-2">
        <div><dt>Before recovery, including WAL</dt><dd>{info.recovery.before.totalBytes.toLocaleString()} bytes</dd></div>
        <div><dt>Current storage, including remaining recovery files</dt><dd>{info.recovery.after.totalBytes.toLocaleString()} bytes</dd></div>
        <div><dt>Database / WAL / shared memory / recovery files</dt><dd>{[info.recovery.after.databaseBytes, info.recovery.after.walBytes, info.recovery.after.shmBytes, info.recovery.after.recoveryBytes].map((bytes) => bytes.toLocaleString()).join(" / ")} bytes</dd></div>
      </dl>
      {info.recovery.backupPath && info.recovery.state === "reopen_verified" ? <>
        <p className="mt-2 break-all">Recovery backup: {info.recovery.backupPath}</p>
        <p className="mt-2">Cadence verified and reopened the repaired database. Delete only this recovery backup when you no longer need it.</p>
        <label className="mt-2 flex min-h-11 items-center gap-3"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.currentTarget.checked)} />Permanently delete this recovery backup</label>
        <button type="button" disabled={busy || !deleteConfirmed || !onDeleteRecoveryBackup} onClick={onDeleteRecoveryBackup} className="product-action product-action-danger mt-2 min-h-11 py-2">Delete recovery backup</button>
      </> : <p className="mt-2">{info.recovery.state === "backup_deleted" ? "The recovery backup was deleted after verification." : "Storage recovery has not finished. Cadence has preserved the recovery files."}</p>}
    </div> : null}
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
      <button type="button" disabled={busy || !info} onClick={onReveal} className="product-action product-action-secondary min-h-11 py-2 text-sm">Reveal in Finder</button>
      <button type="button" disabled={busy || !info} onClick={onBackup} className="product-action product-action-primary min-h-11 py-2 text-sm">Back Up</button>
    </div>
    {info && !info.localMode ? <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">Disconnect the account before restoring a raw database backup.</p> : <div className="mt-6 max-w-md border-t border-line pt-4">
      <label htmlFor="database-restore-confirmation" className="text-sm leading-6">Type RESTORE to replace local data</label>
      <input id="database-restore-confirmation" value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} autoComplete="off" className="mt-2 block min-h-11 w-full border border-line bg-background px-3 py-2 text-sm" />
      <p className="mt-3 text-sm leading-6 text-muted-readable">Cadence validates the backup and protects the current database before replacement.</p>
      <button type="button" disabled={busy || !info || confirmation !== "RESTORE"} onClick={onRestore} className="product-action product-action-danger mt-3 min-h-11 py-2 text-sm">Restore local database</button>
    </div>}
    {message ? <p role="status" aria-live="polite" className="mt-4 max-w-2xl break-all text-sm leading-6">{message}</p> : null}
  </section>;
}
