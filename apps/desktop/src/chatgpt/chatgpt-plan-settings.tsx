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
  connection: Pick<ChatGptConnection, "status" | "cancelConnect" | "disconnect">;
  /** Shared with the Daily Brief, so a sign-in from either place refreshes both. */
  connect: () => Promise<ChatGptConnectionStatus>;
  openUsage: () => void;
  confirmed?: Flag;
}>) {
  const [status, setStatus] = useState<ChatGptConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(() => {
    // A sign-in started from the Daily Brief gets its one-time confirmation here.
    void connection.status().then((next) => { if (mounted.current) { setStatus(next); if (next.state === "connectedWithPlanUsage" && !confirmed.read()) setConfirmation(true); } },
      (failure: unknown) => { if (mounted.current) { setStatus({ state: "disconnected", email: null }); setError(text(failure)); } });
  }, [connection, confirmed]);
  useEffect(load, [load]);

  const onConnect = () => {
    setConnecting(true); setError(undefined); setMessage(undefined);
    void connect().then((next) => {
      if (!mounted.current) return;
      setStatus(next);
      // OpenAI's guidelines: confirm plan use once, after the first sign-in with plan usage.
      if (next.state === "connectedWithPlanUsage" && !confirmed.read()) setConfirmation(true);
    }, (failure: unknown) => { if (mounted.current) setError(text(failure)); })
      .finally(() => { if (mounted.current) setConnecting(false); });
  };
  const onCancel = () => { void connection.cancelConnect(); };
  const onDisconnect = () => {
    setBusy(true); setError(undefined); setMessage(undefined); setConfirmation(false);
    void connection.disconnect().then((outcome) => {
      if (!mounted.current) return;
      setStatus({ state: "disconnected", email: null });
      setMessage(outcome === "revocationFailed"
        ? "ChatGPT is disconnected on this Mac. OpenAI did not confirm it, so Cadence may still be listed in your ChatGPT settings."
        : "ChatGPT is disconnected.");
    }, (failure: unknown) => { if (mounted.current) setError(text(failure)); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };
  const onConfirm = () => { confirmed.write(); setConfirmation(false); };

  const state: ChatGptPlanCardState = connecting ? "connecting" : status?.state ?? "loading";
  return <ChatGptPlanCard state={state} email={status?.email ?? null} busy={busy} message={message} error={error} confirmation={confirmation}
    onConnect={onConnect} onCancel={onCancel} onDisconnect={onDisconnect} onManageUsage={openUsage} onConfirm={onConfirm} />;
}

function text(failure: unknown): string {
  return failure instanceof Error && failure.message ? failure.message : "ChatGPT did not respond. Try again.";
}
