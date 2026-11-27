/**
 * A Period as the screens read it (Ticket 369, D35): the fields the chips, the list
 * and the editor show, plus the revision a write must name. Field names match the
 * stored record so the Period resolver's date rules take it directly.
 */
export type PeriodView = Readonly<{
  id: string;
  label: string;
  start_on: string;
  end_on: string | null;
  note: string | null;
  revision: number;
}>;

/** The notice a Period action names: an outcome on success, the conflict on a stale write. */
export type PeriodNoticeId = "period.saved" | "period.ended" | "period.removed" | "period.conflict";

/**
 * The result of saving, ending or removing a Period. `message` is the sentence to
 * show: the notice's text when `noticeId` is set, otherwise the rule the write broke.
 */
export type PeriodActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  noticeId?: PeriodNoticeId;
}>;

/**
 * The result of the auto-saving Period note field. It has the shape the shared note
 * editor reads, plus the Period's revision after the save, so a following write can
 * name it.
 */
export type PeriodNoteActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  revision?: number;
}>;
