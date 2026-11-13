"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render(
    container: HTMLElement,
    options: { sitekey: string; size?: string; callback?: (token: string) => void },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

// Ticket 332: Cloudflare Turnstile inside a form. Turnstile adds the hidden
// `cf-turnstile-response` field that the request route passes to Supabase Auth.
// Ticket 336: `onToken` lets the Mac's email page send as soon as the check passes.
export function TurnstileField({
  siteKey,
  onToken,
}: Readonly<{ siteKey: string; onToken?: (token: string) => void }>) {
  const container = useRef<HTMLDivElement>(null);
  const tokenHandler = useRef(onToken);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    tokenHandler.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const turnstile = window.turnstile;
    if (!loaded || !container.current || !turnstile) return;
    const widgetId = turnstile.render(container.current, {
      sitekey: siteKey,
      size: "flexible",
      callback: (token) => tokenHandler.current?.(token),
    });
    return () => turnstile.remove(widgetId);
  }, [loaded, siteKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      <div ref={container} />
    </>
  );
}
