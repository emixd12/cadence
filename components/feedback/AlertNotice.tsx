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
  className?: string;
}>;

export function AlertNotice({ kind, children, label, action, className }: AlertNoticeProps) {
  return (
    <div
      role={ANNOUNCE[kind]}
      data-alert-kind={kind}
      className={["grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-base leading-6 text-alert-foreground", className].filter(Boolean).join(" ")}
    >
      <TriangleAlert aria-hidden="true" className="mt-1 size-4 text-alert-signal" strokeWidth={1.75} />
      <p className="text-sm uppercase tracking-[1px] text-alert-signal">{label ?? ALERT_NOTICE_LABELS[kind]}</p>
      <div className="col-start-2 max-w-prose">{children}</div>
      {action ? <div className="col-start-2 text-sm">{action}</div> : null}
    </div>
  );
}
