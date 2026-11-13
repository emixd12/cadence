"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DESKTOP_EMAIL_REQUEST_ROUTE,
  desktopEmailSentCallback,
  parseDesktopEmailFragment,
  type DesktopEmailFragment,
} from "@/lib/auth/desktop-sign-in";
import { TurnstileField } from "../../TurnstileField";

type Step =
  | { kind: "reading" }
  | { kind: "missing" }
  | { kind: "ready"; flow: DesktopEmailFragment; error?: string }
  | { kind: "sending"; flow: DesktopEmailFragment }
  | { kind: "sent"; flow: DesktopEmailFragment };

const SEND_FAILED = "The email could not be sent. Try again.";

// Ticket 336: sends the code for Cadence for Mac. With Turnstile on, it sends as soon
// as the check passes; without it, it sends on load. The code is typed in the Mac app.
export function MacEmailCodeRequest({
  codeLength,
  turnstileSiteKey,
}: Readonly<{ codeLength: number; turnstileSiteKey: string | null }>) {
  const [step, setStep] = useState<Step>({ kind: "reading" });
  const [attempt, setAttempt] = useState(0);
  const [retryToken, setRetryToken] = useState<string | null>(null);
  const sending = useRef(false);

  const send = useCallback(async (flow: DesktopEmailFragment, captchaToken?: string) => {
    if (sending.current) return;
    sending.current = true;
    setStep({ kind: "sending", flow });
    try {
      const response = await fetch(DESKTOP_EMAIL_REQUEST_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: flow.email, captchaToken }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (response.ok && body?.ok) setStep({ kind: "sent", flow });
      else setStep({ kind: "ready", flow, error: body?.message || SEND_FAILED });
    } catch {
      setStep({ kind: "ready", flow, error: SEND_FAILED });
    } finally {
      // A Turnstile token works once. A retry waits for a new one and a click.
      setRetryToken(null);
      setAttempt((value) => value + 1);
      sending.current = false;
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- the fragment is readable only after hydration */
  useEffect(() => {
    const flow = parseDesktopEmailFragment(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Without a bot check, the click in the Mac app was the request, so the page sends at once.
    if (flow && !turnstileSiteKey) void send(flow);
    else setStep(flow ? { kind: "ready", flow } : { kind: "missing" });
  }, [send, turnstileSiteKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (step.kind === "reading") return null;
  if (step.kind === "missing") {
    return (
      <p role="alert" className="mt-6 text-sm leading-6 text-accent">
        This page opens from Cadence for Mac. Go back to Cadence and choose Continue
        with email again.
      </p>
    );
  }

  const email = <span className="break-all font-bold">{step.flow.email}</span>;
  if (step.kind === "sent") {
    return (
      <>
        <p className="mt-3 text-lg leading-6 text-muted-readable">Check your email.</p>
        <p className="mt-6 text-sm leading-6">
          Cadence sent a {codeLength}-digit code to {email}. Type it in Cadence for Mac.
          You can close this page.
        </p>
        <a
          href={desktopEmailSentCallback(step.flow.state)}
          className="product-action product-action-primary mt-6 min-h-11 py-2 text-base font-bold"
        >
          Return to Cadence
        </a>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 text-lg leading-6 text-muted-readable">Sign in to Cadence for Mac.</p>
      <p className="mt-6 text-sm leading-6">
        {step.kind === "sending" ? "Sending" : "Cadence sends"} a {codeLength}-digit code to {email}.
      </p>
      {step.kind === "ready" && step.error ? (
        <p role="alert" className="mt-6 text-sm leading-6 text-accent">{step.error}</p>
      ) : null}
      {turnstileSiteKey && step.kind === "ready" ? (
        <div className="mt-6">
          <TurnstileField
            key={attempt}
            siteKey={turnstileSiteKey}
            onToken={(token) => (step.error ? setRetryToken(token) : void send(step.flow, token))}
          />
        </div>
      ) : null}
      {step.kind === "ready" && step.error ? (
        <button
          type="button"
          disabled={Boolean(turnstileSiteKey) && !retryToken}
          onClick={() => void send(step.flow, retryToken ?? undefined)}
          className="product-action product-action-primary mt-6 min-h-11 py-2 text-base font-bold"
        >
          Send the code again
        </button>
      ) : null}
    </>
  );
}
