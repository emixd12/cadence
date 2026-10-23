// Paste the returned source into ws.hook.schedule; it performs cleanup, not an agent reminder.
export function publicTrustWindowHook(directory) {
  if (!/^\.intent\/artifacts\/trust232\/[a-z0-9-]+$/.test(directory)) {
    throw new Error("Invalid diagnostic receipt directory");
  }
  return `
let phase = "retry";
try {
  const result = await ws.host.exec({
    command: "python3",
    args: ["scripts/watch-public-trust-window.py", ${JSON.stringify(directory)}],
    timeoutMs: 50000
  });
  const data = result.exitCode === 0 ? JSON.parse(result.stdout) : {};
  if (["waiting", "cleanup_wait", "retry", "busy"].includes(data.event)) phase = data.event;
  if (data.event === "restored" && data.tagAbsent === true) {
    return { dispatch: true, message: "Diagnostic access restored; verify the retained receipt.", state: { restored: true } };
  }
} catch {}
return { dispatch: false, state: { restored: false, phase, attempts: (hookState?.attempts ?? 0) + 1 } };
`;
}
