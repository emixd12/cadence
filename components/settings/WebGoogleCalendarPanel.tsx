"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { GoogleCalendarPanel } from "./GoogleCalendarPanel";
import { SIGN_IN_METHODS_METHOD_PARAM, SIGN_IN_METHODS_RESULT_PARAM } from "@/lib/auth/account-sign-in-methods";
import { CALENDAR_AFTER_GOOGLE_SIGN_IN } from "@/lib/types/google-calendar";
import { calendarRangeForToday, webGoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

export function WebGoogleCalendarPanel({ timezone, nested = false }: Readonly<{ timezone: string; nested?: boolean }>) {
  const refreshRange = useMemo(() => calendarRangeForToday(timezone), [timezone]);
  const searchParams = useSearchParams();
  const result = searchParams?.get("calendar") ?? null;
  // Ticket 335: read once, because the address is cleaned up below.
  const [afterSignIn] = useState(() => result === CALENDAR_AFTER_GOOGLE_SIGN_IN
    ? calendarAfterGoogleSignIn(searchParams?.get(SIGN_IN_METHODS_RESULT_PARAM) ?? null, searchParams?.get(SIGN_IN_METHODS_METHOD_PARAM) ?? null)
    : null);
  // The address alone never starts anything: a link from another site can set it, so
  // Calendar consent waits for the person to select Connect Google Calendar.
  useEffect(() => {
    if (!afterSignIn) return;
    const url = new URL(window.location.href);
    for (const name of ["calendar", SIGN_IN_METHODS_RESULT_PARAM, SIGN_IN_METHODS_METHOD_PARAM]) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [afterSignIn]);

  const message = afterSignIn ?? calendarCallbackMessage(result);
  return <GoogleCalendarPanel coordinator={webGoogleCalendarCoordinator} refreshRange={refreshRange} callbackMessage={message} wrongAccount={result === "same_account_required"} nested={nested} />;
}

/** Ticket 335 (D31.5): the message on return from adding Google as a sign-in method before Calendar. */
export function calendarAfterGoogleSignIn(result: string | null, method: string | null): string {
  if (result === "added" && method === "google") return "Google added as a way to sign in. Select Connect Google Calendar to give Cadence access to your calendars.";
  if (result === "taken") {
    return "That Google account already signs in to a different Cadence account, so Google Calendar cannot connect it here. Cadence does not merge accounts. Choose another Google account.";
  }
  return "Google was not added, so Google Calendar did not connect. Try again.";
}

export function calendarCallbackMessage(code: string | null): string | undefined {
  if (code === "connected") return "Google Calendar connected. Choose the calendars Cadence can show.";
  if (code === "cancelled" || code === "consent_denied") return "Google Calendar permission was not granted. You can try again.";
  if (code === "same_account_required") return "Use the same Google account as the Cadence account that started this Calendar connection.";
  if (code === "reconnect_required") return "Google Calendar needs reconnection. Reconnect to continue.";
  if (code === "unauthenticated") return "Sign in to the same Cadence account and reconnect Google Calendar.";
  if (code === "error" || code === "invalid_request") return "Google Calendar did not connect. Try again.";
  return undefined;
}
