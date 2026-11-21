"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { useFormStatus } from "react-dom";
import { Check, X } from "lucide-react";
import { useRefresh } from "@cadence/ui/runtime";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import type { TimelineParentGroupView } from "@cadence/core/types/timeline";

import { playCompletionChime, prepareCompletionChimeForUserGesture } from "@/lib/ui/completion-feedback";
import type { OccurrenceActionState, OccurrenceFormAction } from "@/lib/types/timeline";
import { useSemanticZoomLayer } from "./use-semantic-zoom";
import styles from "./parent-occurrence-row.module.css";

type ParentOccurrenceRowProps = Readonly<{
  group: TimelineParentGroupView;
  /** Controlled expansion (Semantic Zoom). Without it the row follows the device's layer. */
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Marks every sub-behavior in this slot at once. Web: `markParentSlotStatusAction`. The Mac
   * injects its local action. Without it the row offers no bulk marking.
   */
  parentSlotStatusAction?: OccurrenceFormAction;
  statusIconsOnly?: boolean;
  reducedMotion?: boolean;
  /** The day-progress axis measures this element while the routine is collapsed. */
  headerRef?: Ref<HTMLDivElement>;
  headerClassName?: string;
  /** The sub-behavior rows, shown under the header while expanded. */
  children: ReactNode;
}>;

type BulkStatus = "completed" | "not_completed";

const TONE_CLASSES: Record<TimelineParentGroupView["visualTone"], string> = {
  default: "bg-background text-foreground hover:bg-timeline-row-hover",
  needs_decision: "bg-surface text-foreground hover:bg-timeline-needs-decision-hover",
  completed: "bg-primary text-primary-foreground hover:bg-timeline-completed-hover",
  not_completed: "bg-accent text-primary-foreground hover:bg-accent",
};

const MUTED_TONE: Record<TimelineParentGroupView["visualTone"], string> = {
  default: "text-muted-readable",
  needs_decision: "text-foreground",
  completed: "text-primary-foreground",
  not_completed: "text-primary-foreground",
};

const IDLE: OccurrenceActionState = { status: "idle", message: "" };

export function ParentOccurrenceRow({
  group,
  expanded,
  onToggle,
  parentSlotStatusAction,
  statusIconsOnly = false,
  reducedMotion = false,
  headerRef,
  headerClassName,
  children,
}: ParentOccurrenceRowProps) {
  const layer = useSemanticZoomLayer();
  const [localOverride, setLocalOverride] = useState<Readonly<{ layer: string; open: boolean }> | null>(null);
  const isControlled = expanded !== undefined;
  // An uncontrolled row (Needs decision) keeps its own click until the layer changes.
  const isOpen = isControlled ? expanded
    : localOverride && localOverride.layer === layer ? localOverride.open : layer === "sub_behaviors";
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setLocalOverride({ layer, open: !isOpen });
  };
  const childrenId = `${useId()}-steps`;
  const { rollup } = group;
  const isResolved = rollup.status === "completed" || rollup.status === "not_completed";
  const showBulk = Boolean(parentSlotStatusAction) && group.showDecisionActions;
  const progressText = `${rollup.completedCount} of ${rollup.totalCount} completed`;

  return (
    <article
      className={["timeline-parent-row", styles.row].join(" ")}
      data-parent-behavior-id={group.parentBehaviorId}
      data-parent-slot-key={group.key}
      data-parent-status={rollup.status}
      data-expanded={isOpen ? "true" : "false"}
      data-motion={reducedMotion ? "reduced" : undefined}
    >
      <div
        ref={headerRef}
        className={[
          "timeline-occurrence-row transition-colors",
          styles.header,
          TONE_CLASSES[group.visualTone],
          headerClassName ?? "",
        ].join(" ")}
        data-visual-tone={group.visualTone}
        data-status-icons-only={statusIconsOnly ? "true" : "false"}
        data-parent-marks={showBulk ? "actions" : isResolved ? "label" : "none"}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={childrenId}
            onClick={toggle}
            className={[
              "timeline-occurrence-summary col-start-1 col-end-3 row-start-1 grid min-h-12 w-full items-center py-1.5 pl-3 text-left sm:py-2 sm:pl-4",
              showBulk ? "pr-56" : isResolved ? "pr-36 sm:pr-40" : "pr-3",
            ].join(" ")}
          >
            <span className="timeline-occurrence-main grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-1">
              <time
                dateTime={group.scheduledFor}
                className={["timeline-occurrence-time min-w-0 whitespace-nowrap text-sm font-bold leading-5", MUTED_TONE[group.visualTone]].join(" ")}
              >
                {group.scheduledTimeLabel}
              </time>
              <span className={["flex min-w-0 items-center gap-2", styles.titleLine].join(" ")}>
                <span
                  aria-hidden="true"
                  className={["product-disclosure-indicator", styles.indicator].join(" ")}
                  data-open={isOpen ? "true" : "false"}
                  data-tone={group.visualTone}
                />
                <span className="timeline-occurrence-title timeline-parent-title min-w-0 truncate text-base font-bold leading-tight sm:text-lg">
                  {group.title}
                </span>
                {!isResolved ? (
                  <span className={["shrink-0 text-sm font-bold leading-5 tabular-nums", MUTED_TONE[group.visualTone]].join(" ")} data-parent-progress>
                    <span aria-hidden="true">{rollup.progressLabel}</span>
                    <span className="sr-only">, {progressText}</span>
                  </span>
                ) : null}
              </span>
            </span>
          </button>

          {showBulk && parentSlotStatusAction ? (
            <ParentBulkActions
              group={group}
              action={parentSlotStatusAction}
              iconOnly={statusIconsOnly}
            />
          ) : isResolved ? (
            <p
              className={[
                "timeline-occurrence-status pointer-events-none col-start-2 row-start-1 z-10 mr-3 flex min-h-12 items-center self-start justify-self-end whitespace-nowrap text-xs font-bold leading-5 sm:mr-4 sm:text-sm",
                MUTED_TONE[group.visualTone],
              ].join(" ")}
              data-status-region="label"
            >
              {rollup.statusLabel}
            </p>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <div
          id={childrenId}
          role="group"
          aria-label={`${group.title} steps`}
          className={["timeline-parent-children grid gap-1 pt-1", styles.children].join(" ")}
          data-parent-children
        >
          {children}
        </div>
      ) : null}
    </article>
  );
}

function ParentBulkActions({
  group,
  action,
  iconOnly,
}: Readonly<{
  group: TimelineParentGroupView;
  action: OccurrenceFormAction;
  iconOnly: boolean;
}>) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const refresh = useRefresh();
  const submitted = useRef<BulkStatus | null>(null);

  useEffect(() => {
    if (state.status === "idle") return;
    if (state.status === "success" && submitted.current === "completed") void playCompletionChime();
    submitted.current = null;
    refresh();
  }, [refresh, state]);

  return (
    <div
      className="timeline-occurrence-status pointer-events-none col-start-2 row-start-1 z-10 mr-3 grid min-h-12 items-center self-start justify-self-end sm:mr-4"
      data-status-region="actions"
    >
      <div className="flex items-center justify-end gap-x-2">
        {(["completed", "not_completed"] as const).map((status) => (
          <form
            key={status}
            action={formAction}
            className="contents"
            onSubmit={() => { submitted.current = status; }}
          >
            <input type="hidden" name="parent_behavior_id" value={group.parentBehaviorId} />
            <input type="hidden" name="status" value={status} />
            {group.children.map((child) => (
              <input key={child.id} type="hidden" name="occurrence_id" value={child.id} />
            ))}
            <BulkButton status={status} title={group.title} iconOnly={iconOnly} disabled={isPending} />
          </form>
        ))}
      </div>
      {state.status === "error" && state.message ? (
        <AlertNotice kind="write_refused" variant="inline" size="compact" label={false} className="pointer-events-auto pt-1 text-right">
          {state.message}
        </AlertNotice>
      ) : null}
    </div>
  );
}

function BulkButton({
  status,
  title,
  iconOnly,
  disabled,
}: Readonly<{ status: BulkStatus; title: string; iconOnly: boolean; disabled: boolean }>) {
  const { pending } = useFormStatus();
  const label = status === "completed" ? "Completed" : "Not Completed";
  const Icon = status === "completed" ? Check : X;
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-disabled={pending || disabled ? "true" : undefined}
      aria-label={pending ? `Saving ${title} ${label}` : `Mark ${title} ${label}`}
      title={iconOnly ? label : undefined}
      data-single-line="true"
      data-parent-status-action={status}
      onPointerDown={status === "completed" ? prepareCompletionChimeForUserGesture : undefined}
      className="timeline-status-action product-action product-action-primary pointer-events-auto min-h-11 min-w-11 gap-1.5 whitespace-nowrap px-1 py-1 text-base font-bold sm:min-h-8 sm:px-0 sm:text-sm"
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2.5} />
      <span className={iconOnly ? "sr-only" : undefined}>{pending ? `Saving ${label}...` : label}</span>
    </button>
  );
}
