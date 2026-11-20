import type { ReactNode } from "react";
import { noticeEntry, noticeText, type NoticeId, type NoticeParams } from "@cadence/core/notices";
import { AlertNotice } from "@/components/feedback/AlertNotice";

/**
 * Shows one notice from the notices library (packages/core/src/notices) in its style.
 * The catalog owns the words and the style; a screen only picks the id, the values,
 * the size and the place (docs/NOTICES.md).
 *
 * - outcome: Ink italic. An action beside it (Undo) stays upright.
 * - error: one Rust Signal line, through the Alert notice's inline variant, with any
 *   action below in Ink.
 * - note: Readable Ash. The caller sets the size (usually `text-xs`).
 * - question: Ink, upright, with its answers beside it.
 *
 * Raw `role="status"` or `role="alert"` belong here and in the feedback components
 * only (tests/notices.test.ts keeps the remaining exceptions from growing).
 */

const STYLE_CLASS = {
  outcome: "italic text-foreground",
  note: "text-muted-readable",
  question: "text-foreground",
} as const;

export type NoticeProps = Readonly<{
  id: NoticeId;
  params?: NoticeParams;
  /** Links that act on the notice: beside it, upright; below it for an error. */
  action?: ReactNode;
  /**
   * How a screen reader hears it. Errors follow their Alert notice kind; outcomes are
   * announced politely; notes and questions are not announced unless asked.
   */
  announce?: "status" | "alert" | false;
  /** For errors: "compact" is the Timeline row's detail size, "small" the note size. */
  size?: "body" | "compact" | "small";
  as?: "p" | "span" | "div";
  className?: string;
  /** Extra attributes for tests and tools. */
  data?: Readonly<Record<`data-${string}`, string | boolean | undefined>>;
}>;

export function Notice({ id, params, action, announce, size = "compact", as = "p", className, data }: NoticeProps) {
  const entry = noticeEntry(id);
  const text = noticeText(id, params);
  if (entry.style === "error") {
    return (
      <AlertNotice kind={entry.alert ?? "write_refused"} label={entry.label ?? false} variant="inline" size={size} action={action}
        className={className} announce={announce} data={{ "data-notice": id, ...data }}>
        {text}
      </AlertNotice>
    );
  }
  const Tag = as;
  const role = announce === undefined ? (entry.style === "outcome" ? "status" : undefined) : announce || undefined;
  return (
    <Tag role={role} data-notice={id} {...data} className={[STYLE_CLASS[entry.style], className].filter(Boolean).join(" ")}>
      {text}
      {action ? <>{" "}<span className="not-italic">{action}</span></> : null}
    </Tag>
  );
}
