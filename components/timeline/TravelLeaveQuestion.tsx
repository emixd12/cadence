"use client";

import { useState } from "react";
import type { TravelLeaveAnswer } from "@cadence/core/types/travel";

const ANSWERS: ReadonlyArray<{ value: TravelLeaveAnswer; label: string }> = [
  { value: "too_early", label: "Too early" },
  { value: "about_right", label: "About right" },
  { value: "too_late", label: "Too late" },
];

/**
 * Ticket 217: asked once a day after a journey with a routed outbound leg.
 * An answer is stored; Not now records nothing.
 */
export function TravelLeaveQuestion({ title, className, onAnswer, onDismiss }: Readonly<{
  title: string;
  className?: string;
  /** Resolves to the confirmation to show, or rejects when the answer did not save. */
  onAnswer: (answer: TravelLeaveAnswer) => Promise<string>;
  onDismiss: () => void;
}>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const answer = async (value: TravelLeaveAnswer) => {
    setPending(true); setMessage("");
    try { setMessage(await onAnswer(value)); }
    catch { setMessage("The answer could not save. Try again."); }
    finally { setPending(false); }
  };
  return <section className={className} aria-label="Leave time question">
    <p>Your leave time for <span className="[overflow-wrap:anywhere]">{title}</span> was:</p>
    <div className="flex flex-wrap gap-x-4">
      {ANSWERS.map((item) => <button key={item.value} type="button" className="text-link min-h-11" disabled={pending}
        onClick={() => { void answer(item.value); }}>{item.label}</button>)}
      <button type="button" className="text-link min-h-11 text-muted-readable" disabled={pending} onClick={onDismiss}>Not now</button>
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
