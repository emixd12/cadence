"use client";

import { useState } from "react";
import type { TimelineOccurrenceView, TimelineOpportunityPoolItem, TimelineView } from "@cadence/core/types/timeline";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { OpportunityBasket } from "@/components/timeline/OpportunityBasket";
import type { OpportunityActionState } from "@/lib/types/timeline";
import timelineStyles from "@/components/timeline/day-progress-timeline.module.css";

// Behaviors of Opportunity. Synthetic data; nothing is stored. "Stretch" refuses Done now
// to show a refusal; the removable row refuses its second Remove as "not found".

const TZ = "America/New_York";

function fixtures(): Readonly<{ timeline: TimelineView; rows: TimelineOccurrenceView[]; now: string }> {
  // Rounded to 5 minutes so the server and client renders agree.
  const now = new Date(Math.floor(Date.now() / 300_000) * 300_000);
  const localDate = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const at = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000);
  const localTime = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const label = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  const pool: TimelineOpportunityPoolItem[] = [
    { behaviorId: "11111111-1111-4111-8111-111111111111", title: "Call a friend", categoryName: "People", defaultDurationMinutes: 20,
      whereKind: "anywhere", locationText: null, onToday: false, lengthMinutes: 20,
      suggestedStart: { startsAt: at(5).toISOString(), localTime: localTime(at(5)), source: "now" } },
    { behaviorId: "22222222-2222-4222-8222-222222222222", title: "Stretch", categoryName: "Fitness", defaultDurationMinutes: null,
      whereKind: "home", locationText: null, onToday: true, lengthMinutes: 30,
      suggestedStart: { startsAt: at(45).toISOString(), localTime: localTime(at(45)), source: "free_slot" } },
  ];
  const base: TimelineOccurrenceView = {
    id: "bench-added", behaviorId: pool[1]!.behaviorId, title: "Stretch", scheduledFor: at(-30).toISOString(), scheduledTimeLabel: label(at(-30)),
    scheduleKind: "exact", localDate, status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
    expandedStatusActionLabel: "Change status", visualTone: "default", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false,
    description: "", categoryName: "Fitness", scheduleSummary: "", note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
    origin: "opportunity", addedBy: "user", canRemove: true,
  };
  const rows: TimelineOccurrenceView[] = [
    base,
    { ...base, id: "bench-brief", title: "Call a friend", behaviorId: pool[0]!.behaviorId, addedBy: "daily_brief", canRemove: false, note: "Ask about the trip." },
    { ...base, id: "bench-done", title: "Stretch", scheduledFor: at(-120).toISOString(), scheduledTimeLabel: label(at(-120)), status: "completed",
      statusLabel: "Completed", visualTone: "completed", showDecisionActions: false, showCollapsedStatusLabel: true, canRemove: false, addedBy: "chat" },
  ];
  const timeline: TimelineView = {
    opportunityPool: pool, timezone: TZ, todayLocalDate: localDate, visibleFutureDays: 0, maxFutureDays: 0, nextFutureDays: null,
    needsDecision: { title: "Needs decision", occurrenceCount: 0, emptyMessage: "", daySections: [] },
    daySections: [],
  };
  return { timeline, rows, now: now.toISOString() };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

async function addAction(_state: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  await wait();
  const title = formData.get("behavior_id") === "22222222-2222-4222-8222-222222222222" ? "Stretch" : "Call a friend";
  if (formData.get("placement") === "done_now") {
    if (title === "Stretch") return { status: "refused", reason: "not_running", noticeId: "opportunity.refused.not-running", noticeParams: { title } };
    return { status: "logged", occurrenceId: String(formData.get("client_occurrence_id")), noticeId: "opportunity.logged", noticeParams: { title, time: "now" } };
  }
  const start = String(formData.get("start_time") ?? formData.get("preset") ?? "");
  return { status: "added", occurrenceId: String(formData.get("client_occurrence_id")), noticeId: "opportunity.added", noticeParams: { title, time: start } };
}

let removed = false;
async function removeAction(_state: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  await wait();
  const title = String(formData.get("title"));
  if (removed) return { status: "refused", reason: "not_found", noticeId: "opportunity.remove-refused.not-found", noticeParams: { title } };
  removed = true;
  return { status: "removed", occurrenceId: String(formData.get("occurrence_id")), noticeId: "opportunity.removed", noticeParams: { title } };
}

const noop = async () => ({ status: "idle" as const, message: "" });

export function OpportunityBasketBench() {
  const [data] = useState(fixtures);
  return (
    <div className={`grid max-w-3xl gap-4 ${timelineStyles.timeline}`}>
      <div className="border-b border-line pb-3">
        <p className="text-sm font-bold text-muted-readable">Today</p>
        <h2 className="text-3xl font-bold leading-tight">{new Date(data.now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ })}</h2>
        <OpportunityBasket timeline={data.timeline} now={data.now} addAction={addAction} />
      </div>
      <div className="grid gap-1">
        {data.rows.map((occurrence) => (
          <div key={occurrence.id} className={timelineStyles.row}>
            <OccurrenceRow occurrence={occurrence} statusAction={noop as never} noteAction={noop as never}
              startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never}
              removeOpportunityAction={removeAction} />
          </div>
        ))}
      </div>
    </div>
  );
}
