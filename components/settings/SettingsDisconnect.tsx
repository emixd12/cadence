"use client";

import { useEffect, useRef, useState } from "react";

const DANGER = "product-action product-action-danger min-h-11 w-fit px-3 py-2 text-sm font-bold";
const SECONDARY = "product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold";

/**
 * Ticket 303: a source's Disconnect asks first, in place. The first click shows the
 * question with a destructive **Disconnect** and **Cancel**; focus moves to Cancel and
 * returns to the button when the person cancels. Connected apps uses the same style.
 */
export function SettingsDisconnect({ label, question, pendingLabel, pending, disabled, onConfirm }: Readonly<{
  /** The button's name, for example "Disconnect Google Calendar". */
  label: string;
  /** One short question, for example "Disconnect Google Calendar?". */
  question: string;
  pendingLabel: string;
  pending: boolean;
  disabled: boolean;
  onConfirm: () => void;
}>) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) { cancel.current?.focus(); return; }
    if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [asking]);
  if (asking) {
    return <div role="group" aria-label={label} className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <span>{question}</span>
      <button type="button" className={DANGER} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>Disconnect</button>
      <button ref={cancel} type="button" className={SECONDARY} onClick={() => { returnFocus.current = true; setAsking(false); }}>Cancel</button>
    </div>;
  }
  return <button ref={trigger} type="button" className={DANGER} disabled={disabled} onClick={() => setAsking(true)}>{pending ? pendingLabel : label}</button>;
}
