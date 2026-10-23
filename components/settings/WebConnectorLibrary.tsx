"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";

import { ConnectorLibrary } from "./ConnectorLibrary";
import { HevyPanel } from "./HevyPanel";
import { IcloudCalendarPanel } from "./IcloudCalendarPanel";
import { OutlookCalendarPanel } from "./OutlookCalendarPanel";
import { WebGoogleCalendarPanel } from "./WebGoogleCalendarPanel";
import { outlookCallbackMessage, outlookTimelineRange, webHevyCoordinator, webIcloudCalendarCoordinator, webOutlookCalendarCoordinator } from "@/lib/ui/connectors";

/** Web Settings connector library: Google (unchanged flow), Outlook, iCloud, and Hevy. */
export function WebConnectorLibrary({ timezone }: Readonly<{ timezone: string }>) {
  const searchParams = useSearchParams();
  const today = useMemo(() => Temporal.Now.zonedDateTimeISO(timezone).toPlainDate().toString(), [timezone]);
  const outlookRange = useMemo(() => outlookTimelineRange(today, Temporal.PlainDate.from(today).add({ days: 7 }).toString(), timezone), [timezone, today]);
  return <ConnectorLibrary sources={[
    { id: "google_calendar", content: <WebGoogleCalendarPanel timezone={timezone} nested /> },
    { id: "outlook_calendar", content: <OutlookCalendarPanel coordinator={webOutlookCalendarCoordinator} refreshRange={outlookRange}
      callbackMessage={outlookCallbackMessage(searchParams?.get("outlook_calendar"))} /> },
    { id: "icloud_calendar", content: <IcloudCalendarPanel coordinator={webIcloudCalendarCoordinator} refreshRange={outlookRange} /> },
    { id: "hevy", content: <HevyPanel coordinator={webHevyCoordinator} localDate={today} timezone={timezone} /> },
  ]} />;
}
