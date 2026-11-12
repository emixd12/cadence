import { useCallback, useEffect, useRef, useState } from "react";
import { ChatGptPlanCard, type ChatGptPlanCardState } from "@/components/briefing/ChatGptPlanCard";
import type { ChatGptConnection, ChatGptConnectionStatus } from "./connection";

/**
 * Ticket 299: the Mac's "Use your ChatGPT plan" Settings card, rendered only with the
 * plan switch on (`plan-switch.ts`). Rust owns sign-in and tokens; this card sees only
 * the state and email. The one-time confirmation flag holds no account data.
 */
export const CHATGPT_PLAN_CONFIRMED_KEY = "cadence.chatgpt-plan.confirmed.v1";

type Flag = Readonly<{ read: () => boolean; write: () => void }>;

const localFlag: Flag = {
  read: () => { try { return window.localStorage.getItem(CHATGPT_PLAN_CONFIRMED_KEY) === "1"; } catch { return false; } },
  write: () => { try { window.localStorage.setItem(CHATGPT_PLAN_CONFIRMED_KEY, "1"); } catch { /* Shown again next time; harmless. */ } },
};

export function ChatGptPlanSettings({ connection, connect, openUsage, confirmed = localFlag }: Readonly<{
  connection: Pick<ChatGptConnection, "status" | "cancelConnect" | "disconnect" | "subscribe" | "isConnecting" | "isChanging">;
  /** Shared with the Daily Brief, so a sign-in from either place refreshes both. */
  connect: () => Promise<ChatGptConnectionStatus>;
  openUsage: () => void;
  confirmed?: Flag;
}>) {
  const [status, setStatus] = useState<ChatGptConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(connection.isConnecting);
  const [busy, setBusy] = useState(() => connection.isChanging() && !connection.isConnecting());
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const revision = useRef(0);
  const actionRevision = useRef(0);

  const load = useCallback(() => {
    // A sign-in started from the Daily Brief gets its one-time confirmation here.
    const current = ++revision.current;
    void connection.status().then((next) => {
      if (!mounted.current || current !== revision.current) return;
      setStatus(next);
      setConfirmation(next.state === "connectedWithPlanUsage" && !confirmed.read());
    }, (failure: unknown) => {
      if (mounted.current && current === revision.current) { setStatus({ state: "disconnected", email: null }); setError(text(failure)); }
    });
  }, [connection, confirmed]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = connection.subscribe((change) => {
      if (change.kind === "start") {
        revision.current += 1;
        actionRevision.current += 1;
        setError(undefined); setMessage(undefined);
      }
      setConnecting(connection.isConnecting());
      setBusy(connection.isChanging() && !connection.isConnecting());
      if (change.kind === "settled") load();
    });
    load();
    window.addEventListener("focus", load);
    return () => { mounted.current = false; revision.current += 1; unsubscribe(); window.removeEventListener("focus", load); };
  }, [connection, load]);

  const failure = (operation: Promise<unknown>) => {
    const current = actionRevision.current;
    void operation.catch((reason: unknown) => {
      if (mounted.current && current === actionRevision.current) setError(text(reason));
    });
  };

  const onConnect = () => {
    setError(undefined); setMessage(undefined);
    failure(connect());
  };
  const onCancel = () => { failure(connection.cancelConnect()); };
  const onDisconnect = () => {
    setBusy(true); setError(undefined); setMessage(undefined); setConfirmation(false);
    const operation = connection.disconnect();
    const current = actionRevision.current;
    failure(operation.then((outcome) => {
      if (!mounted.current || current !== actionRevision.current) return;
      setStatus({ state: "disconnected", email: null });
      setMessage(outcome === "revocationFailed"
        ? "ChatGPT is disconnected on this Mac. OpenAI did not confirm it, so Cadence may still be listed in your ChatGPT settings."
        : "ChatGPT is disconnected.");
    }).finally(() => { if (mounted.current && current === actionRevision.current) setBusy(false); }));
  };
  const onConfirm = () => { confirmed.write(); setConfirmation(false); };

  const state: ChatGptPlanCardState = connecting ? "connecting" : status?.state ?? "loading";
  return <ChatGptPlanCard state={state} email={status?.email ?? null} busy={busy} message={message} error={error} confirmation={confirmation}
    onConnect={onConnect} onCancel={onCancel} onDisconnect={onDisconnect} onManageUsage={openUsage} onConfirm={onConfirm} />;
}

function text(failure: unknown): string {
  return failure instanceof Error && failure.message ? failure.message : "ChatGPT did not respond. Try again.";
}
