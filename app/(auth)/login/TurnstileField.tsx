"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render(container: HTMLElement, options: { sitekey: string; size?: string }): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

// Ticket 332: Cloudflare Turnstile inside a form. Turnstile adds the hidden
// `cf-turnstile-response` field that the request route passes to Supabase Auth.
export function TurnstileField({ siteKey }: Readonly<{ siteKey: string }>) {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const turnstile = window.turnstile;
    if (!loaded || !container.current || !turnstile) return;
    const widgetId = turnstile.render(container.current, {
      sitekey: siteKey,
      size: "flexible",
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
