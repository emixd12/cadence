import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  cancelProbes, nativeAvailable, notifications, readNativeEvents, readSnapshot,
  scheduleProbe, writeSnapshot,
  type NativeEvent, type NotificationResult, type Snapshot,
} from "./native-spike";
import { runNativeCoverageProbe } from "./native-coverage-probe";
import { DESKTOP_APP_RECOVERY_MESSAGE, DesktopErrorBoundary } from "./desktop-error-boundary";

function NativeBench() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [value, setValue] = useState("Persistent SQLite probe");
  const [notificationState, setNotificationState] = useState<NotificationResult>({});
  const [coverageProbe, setCoverageProbe] = useState<Awaited<ReturnType<typeof runNativeCoverageProbe>> | null>(null);
  const [events, setEvents] = useState<NativeEvent[]>([]);
  const [count, setCount] = useState(1);
  const [delay, setDelay] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    async function refresh() {
      try {
        const [saved, state] = await Promise.allSettled([
          readSnapshot(), notifications({ operation: "status" }),
        ]);
        if (active) {
          if (saved.status === "fulfilled") setSnapshot(saved.value);
          if (state.status === "fulfilled") setNotificationState(state.value);
          const failure = [saved, state].find((result) => result.status === "rejected");
          if (failure?.status === "rejected") setMessage(String(failure.reason));
          const updates = await readNativeEvents();
          setEvents((previous) => [...previous, ...updates]);
        }
      } catch (error) {
        if (active) setMessage(String(error));
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try { await action(); } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }

  async function save(forceRollback: boolean) {
    const before = await readSnapshot();
    try {
      const after = await writeSnapshot(value, forceRollback);
      setSnapshot(after);
      if (forceRollback) throw new Error("Rollback failed: the write unexpectedly succeeded.");
      setMessage("SQLite write committed. Quit and reopen to verify persistence.");
    } catch (error) {
      const after = await readSnapshot();
      setSnapshot(after);
      if (forceRollback && String(error).includes("Intentional spike failure:") &&
          before.value === after.value && before.revision === after.revision) {
        setMessage("Rollback verified: value and revision remain unchanged.");
      } else { throw error; }
    }
  }

  async function inspectNotifications(operation: "status" | "requestPermission" | "pending" | "delivered") {
    const result = await notifications({ operation });
    setNotificationState((previous) => ({ ...previous, ...result }));
    setMessage(operation === "pending" ? `${result.pending?.length ?? 0} pending notifications.`
      : operation === "delivered" ? `${result.delivered?.length ?? 0} notifications in macOS delivered storage.`
      : "Permission status refreshed.");
  }

  return <main>
    <header>
      <p>Ticket 108 · Development bench</p>
      <h1>Cadence native boundaries</h1>
      <p>This verifies SQLite and macOS notifications. Tracking parity is not implemented.</p>
    </header>
    {!nativeAvailable && <p className="notice">Browser preview only. Native checks require the Tauri application.</p>}
    <p role="status" aria-live="polite">{busy ? "Running native check…" : message || "No check running."}</p>
    <fieldset disabled={busy || !nativeAvailable}>
      <legend>SQLite persistence and rollback</legend>
      <p>The probe uses its own database. It does not read or change web account data.</p>
      <label htmlFor="probe-value">Test value</label>
      <input id="probe-value" value={value} maxLength={4096} onChange={(event) => setValue(event.target.value)} />
      <div className="actions">
        <button onClick={() => void run(() => save(false))}>Commit test value</button>
        <button onClick={() => void run(() => save(true))}>Verify atomic rollback</button>
        <button onClick={() => void run(async () => { setSnapshot(await readSnapshot()); })}>Read saved value</button>
      </div>
      <dl><dt>Saved value</dt><dd>{snapshot?.value ?? "No value saved"}</dd>
        <dt>Committed revision</dt><dd>{snapshot?.revision ?? "Not read"}</dd></dl>
    </fieldset>
    <fieldset disabled={busy || !nativeAvailable}>
      <legend>macOS scheduled notifications</legend>
      <p>No permission request or notification occurs automatically. Tests use synthetic content.</p>
      <p>Permission: <strong>{notificationState.authorization ?? "Not read"}</strong></p>
      <div className="actions">
        <button onClick={() => void run(() => inspectNotifications("requestPermission"))}>Request notification permission</button>
        <button onClick={() => void run(() => inspectNotifications("status"))}>Refresh permission</button>
      </div>
      <div className="fields">
        <label>Notification count<input type="number" min={1} max={4096} value={count} onChange={(event) => setCount(event.target.valueAsNumber)} /></label>
        <label>Delay in seconds<input type="number" min={10} max={2592000} value={delay} onChange={(event) => setDelay(event.target.valueAsNumber)} /></label>
      </div>
      <p>Use one notification for delivery tests. For capacity tests, set a long delay and cancel afterward.</p>
      <div className="actions">
        <button onClick={() => void run(async () => {
          setCoverageProbe(null);
          const result = await scheduleProbe(count, delay);
          setNotificationState((previous) => ({ ...previous, ...result }));
          setMessage(result.errors?.length || result.missingIds?.length
            ? `Coverage failed: ${result.errors?.length ?? 0} scheduling errors; ${result.missingIds?.length ?? 0} missing notifications.`
            : `Read back ${result.pending?.length ?? 0} pending notifications. Delivery remains unverified.`);
        })}>Schedule test notifications</button>
        <button onClick={() => void run(() => inspectNotifications("pending"))}>Read pending notifications</button>
        <button onClick={() => void run(() => inspectNotifications("delivered"))}>Read delivered notifications</button>
        <button onClick={() => void run(async () => {
          setCoverageProbe(null);
          const result = await cancelProbes();
          setNotificationState((previous) => ({ ...previous, ...result }));
          setMessage(`${result.pending?.length ?? 0} pending test notifications remain. Read delivered notifications to verify cleanup.`);
        })}>Cancel test notifications</button>
      </div>
      <p>Pending: {notificationState.pending?.length ?? "Not read"} · Missing: {notificationState.missingIds?.length ?? "Not checked"}</p>
      <pre>{notificationState.delivered ? JSON.stringify(notificationState.delivered, null, 2) : "Delivered notifications not read."}</pre>
      <p>The coverage probe replaces existing test notifications. It starts in 24 hours, with requests one minute apart. Cancel afterward.</p>
      <button onClick={() => void run(async () => {
        setCoverageProbe(null);
        const probe = await runNativeCoverageProbe(count);
        setNotificationState((previous) => ({ ...previous, ...probe.result, missingIds: probe.coverage.missingIds }));
        setCoverageProbe(probe);
        setMessage(`Coverage ${probe.coverage.status}: ${probe.coverage.scheduledCount} of ${probe.coverage.expectedCount} requests verified.`);
      })}>Verify limited coverage</button>
      {coverageProbe && <dl>
        <dt>Coverage at verification</dt><dd>{coverageProbe.coverage.status}</dd>
        <dt>Target through</dt><dd>{coverageProbe.targetThrough}</dd>
        <dt>Verified through instant</dt><dd>{coverageProbe.coverage.scheduledThrough}</dd>
        <dt>First unscheduled instant</dt><dd>{coverageProbe.coverage.firstUnscheduledAt ?? "None"}</dd>
        <dt>Verified requests</dt><dd>{coverageProbe.coverage.scheduledCount} of {coverageProbe.coverage.expectedCount}</dd>
      </dl>}
    </fieldset>
    <section aria-labelledby="events-title">
      <h2 id="events-title">Activation and resume evidence</h2>
      <button disabled={busy || !nativeAvailable} onClick={() => void run(async () => {
        const updates = await readNativeEvents();
        setEvents((previous) => [...previous, ...updates]);
      })}>Read native events</button>
      <pre>{events.length ? JSON.stringify(events, null, 2) : "No native events observed."}</pre>
      <p>Permission denial, fully quit delivery, sleep/resume, and macOS 14 remain separate acceptance checks.</p>
    </section>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(window.location.search).get("bench") === "native") {
  void import("./spike.css").then(() => root.render(<NativeBench />));
} else if (new URLSearchParams(window.location.search).get("bench") === "settings") {
  void Promise.all([import("./timeline.css"), import("./settings-bench")]).then(([, { SettingsBench }]) => root.render(<SettingsBench />));
} else {
  // Ticket 285: without a boundary, one render error unmounted everything and left a blank window.
  void import("./product").then(({ Product }) => root.render(<DesktopErrorBoundary scope="app"><Product /></DesktopErrorBoundary>)).catch(() => {
    root.render(<main role="alert">{DESKTOP_APP_RECOVERY_MESSAGE}</main>);
  });
}
