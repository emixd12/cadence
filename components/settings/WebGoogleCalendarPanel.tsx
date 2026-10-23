"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { GoogleCalendarPanel } from "./GoogleCalendarPanel";
import { calendarRangeForToday, webAgentGoogleCalendarCoordinator, webGoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

export function WebGoogleCalendarPanel({ timezone, agent = false, nested = false }: Readonly<{ timezone: string; agent?: boolean; nested?: boolean }>) {
  const refreshRange = useMemo(() => calendarRangeForToday(timezone), [timezone]);
  const searchParams = useSearchParams();
  const result = searchParams?.get(agent ? "agentCalendar" : "calendar");
  return <GoogleCalendarPanel agent={agent} coordinator={agent ? webAgentGoogleCalendarCoordinator : webGoogleCalendarCoordinator} refreshRange={refreshRange} callbackMessage={calendarCallbackMessage(result)} wrongAccount={result === "same_account_required"} nested={nested} />;
}

export function calendarCallbackMessage(code: string | null): string | undefined {
  if (code === "connected") return "Google Calendar connected. Choose the calendars Cadence can show.";
  if (code === "cancelled" || code === "consent_denied") return "Google Calendar permission was not granted. You can try again.";
  if (code === "same_account_required") return "Use the same Google account as the Cadence account that started this Calendar connection.";
  if (code === "reconnect_required") return "Google Calendar needs reconnection. Reconnect to continue.";
  if (code === "unauthenticated") return "Sign in to the same Cadence account and reconnect Google Calendar.";
  if (code === "error" || code === "invalid_request") return "Calendar connection could not complete. Try connecting again.";
  return undefined;
}
