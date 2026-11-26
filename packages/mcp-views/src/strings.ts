// The view's words. Notices come from the notices library: the bundle carries the day
// view's catalog file and the catalog's own formatter, never words written here.
// `@cadence/core/notices` is not imported because it would bundle every catalog.
import catalog from "../../core/src/notices/catalog/day-view.json";
import { formatNoticeTemplate, type NoticeParams } from "../../core/src/notices/format";

export type DayViewNoticeId = keyof typeof catalog.notices;

export function notice(id: DayViewNoticeId, params?: NoticeParams): string {
  return formatNoticeTemplate(catalog.notices[id].text, params);
}

/** An error notice's short label ("Not changed"), when it has one. */
export function noticeLabel(id: DayViewNoticeId): string | null {
  const entry = catalog.notices[id];
  return "label" in entry ? entry.label : null;
}

/** Control and section labels. The status words are Cadence's domain terms. */
export const LABELS = {
  today: "Today",
  completed: "Completed",
  notCompleted: "Not Completed",
  note: "Note",
  saveNote: "Save note",
  cancel: "Cancel",
  dayNote: "Day note",
  showSteps: "Show steps",
  hideSteps: "Hide steps",
} as const;

export const STATUS_LABELS = {
  unresolved: "Unresolved",
  completed: "Completed",
  not_completed: "Not Completed",
} as const;
