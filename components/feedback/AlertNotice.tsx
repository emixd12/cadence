import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// One look for "something is wrong", used everywhere (advisor plan, Phase 1C;
// DESIGN.md, "Alert notice"). A person must never mistake an error for advice:
// advice is plain ink in the brief or the advisor's bubble; an alert always carries
// the warning icon and a Rust Signal label naming what went wrong.

export type AlertNoticeKind = "model_failed" | "data_stale" | "budget_reached" | "write_refused";

/** Default labels. Callers may pass a more specific one ("Calendar not current"). */
export const ALERT_NOTICE_LABELS: Readonly<Record<AlertNoticeKind, string>> = Object.freeze({
  model_failed: "Advice unavailable",
  data_stale: "Out of date",
  budget_reached: "Advisor paused",
  write_refused: "Not changed",
});

/**
 * A refused write answers something the person just did, so it is announced at
 * once. The other kinds describe a standing state and are announced politely.
 */
const ANNOUNCE: Readonly<Record<AlertNoticeKind, "alert" | "status">> = Object.freeze({
  model_failed: "status",
  data_stale: "status",
  budget_reached: "status",
  write_refused: "alert",
});

export type AlertNoticeProps = Readonly<{
  kind: AlertNoticeKind;
  /** What happened and what still works, in plain words. */
  children: ReactNode;
  /** Overrides the default label for the kind. Keep it short and factual. */
  label?: string;
  /** One optional text-link action, such as "Try again" or "Pick another time". */
  action?: ReactNode;
  /**
   * The warning icon. On by default; a Timeline row's refused move leaves it out
   * for now (Emi, Nov 18), and the label alone marks the alert.
   */
  icon?: boolean;
  /**
   * "compact" sets the message at the row's detail size, so label, message and
   * action share one size and leading inside a Timeline row.
   */
  size?: "body" | "compact";
  /**
   * "inline" writes the label and message as one Rust Signal sentence at the
   * surrounding text size ("Not changed. 5:30 PM is taken now…"), with the action
   * in Ink below. The Daily Brief uses it (Emi, Nov 19). Implies no icon.
   */
  variant?: "stacked" | "inline";
  className?: string;
}>;

export function AlertNotice({ kind, children, label, action, icon = true, size = "body", variant = "stacked", className }: AlertNoticeProps) {
  const compact = size === "compact";
  if (variant === "inline") {
    return (
      <div role={ANNOUNCE[kind]} data-alert-kind={kind}
        className={["grid gap-y-1", compact ? "text-sm leading-6" : "text-base leading-6", className].filter(Boolean).join(" ")}>
        <p className="text-alert-signal">{label ?? ALERT_NOTICE_LABELS[kind]}. {children}</p>
        {action ? <div className="text-foreground">{action}</div> : null}
      </div>
    );
  }
  return (
    <div
      role={ANNOUNCE[kind]}
      data-alert-kind={kind}
      className={[
        "grid gap-y-1 text-alert-foreground",
        icon ? "grid-cols-[auto_1fr] gap-x-2" : "grid-cols-1",
        compact ? "text-sm leading-5" : "text-base leading-6",
        className,
      ].filter(Boolean).join(" ")}
    >
      {icon ? <TriangleAlert aria-hidden="true" className={compact ? "mt-0.5 size-4 text-alert-signal" : "mt-1 size-4 text-alert-signal"} strokeWidth={1.75} /> : null}
      <p className={["text-sm uppercase tracking-[1px] text-alert-signal", compact ? "leading-5" : ""].filter(Boolean).join(" ")}>{label ?? ALERT_NOTICE_LABELS[kind]}</p>
      <div className={[icon ? "col-start-2" : "", "max-w-prose"].filter(Boolean).join(" ")}>{children}</div>
      {action ? <div className={[icon ? "col-start-2" : "", "text-sm leading-5"].filter(Boolean).join(" ")}>{action}</div> : null}
    </div>
  );
}
