"use client";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { SettingsPartHeading } from "@/components/settings/settings-heading";

/**
 * Ticket 299 (decision D27): the Mac-only "Use your ChatGPT plan" card. Presentational:
 * Cadence for Mac supplies the state and callbacks, and shows it only with its ChatGPT
 * plan switch on. Wording follows OpenAI's Sign in with ChatGPT UI guidelines
 * ("Continue with ChatGPT", "Using ChatGPT plan", "Manage usage", the one-time
 * "You're using your ChatGPT plan" confirmation); `docs/LEGAL.md` L-019. No DevKit code.
 */
export type ChatGptPlanCardState =
  | "loading"
  | "disconnected"
  | "connecting"
  | "connectedWithPlanUsage"
  | "connectedWithoutPlanUsage"
  | "needsReconnect";

export const CHATGPT_PLAN_CARD_TITLE = "Use your ChatGPT plan";
export const CHATGPT_PLAN_CARD_DESCRIPTION =
  "Run the Daily Brief on this Mac with the usage included in your ChatGPT plan. Cadence still prepares each brief and checks the reply. Cadence itself charges nothing.";

/** OpenAI's approved wording on its black format. `data-oai-siwc-button` marks it for OpenAI's checks. */
export function ContinueWithChatGptButton({ onClick, disabled = false, className = "" }: Readonly<{
  onClick: () => void; disabled?: boolean; className?: string;
}>) {
  return (
    <button
      type="button"
      data-oai-siwc-button=""
      disabled={disabled}
      onClick={onClick}
      className={["inline-flex min-h-11 w-fit items-center justify-center border border-foreground bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60", className].filter(Boolean).join(" ")}
    >
      Continue with ChatGPT
    </button>
  );
}

export type ChatGptPlanCardProps = Readonly<{
  state: ChatGptPlanCardState;
  email?: string | null;
  busy?: boolean;
  message?: string;
  error?: string;
  /** The one-time confirmation after the first connection with plan usage. */
  confirmation?: boolean;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onManageUsage: () => void;
  onConfirm: () => void;
}>;

export function ChatGptPlanCard({
  state, email = null, busy = false, message, error, confirmation = false,
  onConnect, onCancel, onDisconnect, onManageUsage, onConfirm,
}: ChatGptPlanCardProps) {
  const connected = state === "connectedWithPlanUsage" || state === "connectedWithoutPlanUsage" || state === "needsReconnect";
  return (
    <SettingsPanel id="chatgpt-plan" title={CHATGPT_PLAN_CARD_TITLE} description={CHATGPT_PLAN_CARD_DESCRIPTION}>
      <div aria-busy={busy || state === "loading" || state === "connecting"} data-chatgpt-plan-state={state} className="grid gap-4">
        {confirmation && state === "connectedWithPlanUsage" ? (
          <div role="status" className="border border-line bg-surface p-3">
            <SettingsPartHeading className="text-lg leading-tight">You’re using your ChatGPT plan</SettingsPartHeading>
            <p className="mt-2 max-w-2xl text-sm leading-6">The Daily Brief on this Mac now uses your ChatGPT plan. You can manage usage in ChatGPT settings.</p>
            <button type="button" onClick={onConfirm} className="product-action product-action-primary mt-3 min-h-11 py-2 text-sm">Got it</button>
          </div>
        ) : null}
        {state === "loading" ? <p role="status" className="text-sm leading-6 text-muted-readable">Checking ChatGPT…</p> : null}
        {state === "connecting" ? <>
          <p role="status" className="max-w-2xl text-sm leading-6">Finish signing in to ChatGPT in your browser.</p>
          <button type="button" onClick={onCancel} className="product-action product-action-secondary min-h-11 w-fit py-2 text-sm">Cancel ChatGPT sign-in</button>
        </> : null}
        {state === "disconnected" ? <>
          <p className="max-w-2xl text-sm leading-6 text-muted-readable">ChatGPT sign-in opens in your browser.</p>
          <ContinueWithChatGptButton onClick={onConnect} disabled={busy} />
        </> : null}
        {connected ? <>
          <dl className="grid gap-3 text-sm leading-6">
            <div className="min-w-0">
              <dt className="text-foreground">ChatGPT account</dt>
              <dd className="break-words text-muted-readable [overflow-wrap:anywhere]">{email ?? "Email not shared"}</dd>
            </div>
            <div>
              <dt className="text-foreground">Daily Brief</dt>
              <dd role="status" className={state === "connectedWithPlanUsage" ? "text-foreground" : "text-accent"}>
                {state === "connectedWithPlanUsage" ? "Using ChatGPT plan"
                  : state === "connectedWithoutPlanUsage" ? "Plan usage is off. The Daily Brief uses Cadence until you turn it on."
                    : "Reconnect ChatGPT to use your plan. The Daily Brief waits until you reconnect or disconnect."}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            {state === "connectedWithPlanUsage"
              ? <button type="button" onClick={onManageUsage} className="product-action product-action-secondary min-h-11 py-2 text-sm">Manage usage</button>
              : <ContinueWithChatGptButton onClick={onConnect} disabled={busy} />}
            <button type="button" onClick={onDisconnect} disabled={busy} className="product-action product-action-secondary min-h-11 py-2 text-sm">Disconnect ChatGPT</button>
          </div>
        </> : null}
        {message ? <p role="status" className="max-w-2xl text-sm leading-6">{message}</p> : null}
        {error ? <p role="alert" className="max-w-2xl text-sm leading-6 text-accent">{error}</p> : null}
      </div>
    </SettingsPanel>
  );
}
