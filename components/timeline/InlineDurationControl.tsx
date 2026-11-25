"use client";

import { useActionState, useId, useState } from "react";
import { formatRecordedDuration } from "@cadence/core/resolvers/time-tracking.resolver";
import type { BehaviorDurationEstimate } from "@cadence/core/types/day-progress";
import { Notice } from "@/components/feedback/Notice";
import type {
  DefaultDurationActionState,
  DefaultDurationFormAction,
} from "@/lib/types/timeline";

type InlineDurationControlProps = Readonly<{
  behaviorId: string;
  estimate: BehaviorDurationEstimate;
  action?: DefaultDurationFormAction;
}>;

const IDLE_STATE: DefaultDurationActionState = {
  status: "idle",
  message: "",
};

function estimateSignature(estimate: BehaviorDurationEstimate): string {
  return estimate.kind === "known"
    ? `${estimate.provenance}:${estimate.seconds}:${estimate.sampleCount}`
    : `unknown:${estimate.sampleCount}`;
}

export function InlineDurationControl({
  behaviorId,
  estimate,
  action,
}: InlineDurationControlProps) {
  const inputId = useId();
  const currentSignature = estimateSignature(estimate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savedOverride, setSavedOverride] = useState<Readonly<{
    minutes: number;
    forSignature: string;
  }> | null>(null);
  const wrappedAction: DefaultDurationFormAction = async (previousState, formData) => {
    if (!action) return IDLE_STATE;
    const submittedSignature = currentSignature;
    const next = await action(previousState, formData);
    if (next.status === "success" && next.minutes != null) {
      setSavedOverride({ minutes: next.minutes, forSignature: submittedSignature });
      setEditing(false);
    }
    return next;
  };
  const [state, submitAction, isPending] = useActionState(
    wrappedAction,
    IDLE_STATE,
  );
  const savedMinutes =
    savedOverride && savedOverride.forSignature === currentSignature
      ? savedOverride.minutes
      : null;

  const effectiveEstimate: BehaviorDurationEstimate =
    savedMinutes !== null
      ? {
          kind: "known",
          seconds: savedMinutes * 60,
          durationLabel: formatRecordedDuration(savedMinutes * 60),
          sampleCount: 0,
          lookbackDays: estimate.lookbackDays,
          provenance: "behavior_default",
        }
      : estimate;

  function openEditor() {
    const initialMinutes =
      effectiveEstimate.kind === "known"
        ? Math.max(1, Math.round(effectiveEstimate.seconds / 60))
        : "";
    setDraft(String(initialMinutes));
    setEditing(true);
  }

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm leading-6 text-muted-readable">
          {formatDurationSummary(effectiveEstimate)}
        </p>
        {action && !editing ? (
          <button
            type="button"
            onClick={openEditor}
            className="product-action product-action-primary text-xs font-bold"
          >
            {effectiveEstimate.kind === "known" &&
            effectiveEstimate.provenance === "behavior_default"
              ? "Change"
              : "Set default"}
          </button>
        ) : null}
      </div>

      {action && editing ? (
        <form
          action={submitAction}
          className="mt-1 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="behavior_id" value={behaviorId} />
          <label htmlFor={inputId} className="sr-only">
            Default duration in minutes
          </label>
          <input
            id={inputId}
            name="default_duration_minutes"
            type="number"
            min={1}
            max={1440}
            step={1}
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Minutes"
            aria-label="Default duration in minutes"
            data-surface="default"
            className="w-24 rounded-md border border-line bg-background px-2.5 py-1 text-sm text-foreground"
            autoFocus
          />
          <span className="text-xs text-muted-readable">min</span>
          <button
            type="submit"
            disabled={isPending}
            className="product-action product-action-primary min-h-8 px-3 py-1 text-xs font-bold"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setEditing(false)}
            className="product-action product-action-secondary text-xs font-bold"
          >
            Cancel
          </button>
          {state.status === "error" && state.noticeId ? (
            <Notice id={state.noticeId} size="small" className="w-full" />
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function formatDurationSummary(estimate: BehaviorDurationEstimate): string {
  if (estimate.kind === "unknown") {
    return "No duration yet — track time below or set a default.";
  }
  if (estimate.provenance === "behavior_default") {
    return `Default: ${estimate.durationLabel}`;
  }
  if (estimate.provenance === "description_estimate") {
    return `About ${estimate.durationLabel} · Estimated from description`;
  }
  const unit = estimate.sampleCount === 1 ? "tracked completion" : "tracked completions";
  return `Usually ${estimate.durationLabel} · Based on ${estimate.sampleCount} ${unit}`;
}
