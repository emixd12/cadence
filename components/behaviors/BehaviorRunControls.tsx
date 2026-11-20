"use client";

import { useActionState, useCallback, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRefresh } from "@cadence/ui/runtime";

import { PauseRangePicker, type PauseRange } from "@/components/behaviors/PauseRangePicker";
import type { BehaviorActionState, BehaviorFormAction, BehaviorView } from "@/lib/types/behavior";
import { localDateIn, runStateOf, type BehaviorRunActionKind } from "@/lib/ui/behavior-run";

/**
 * A Behavior's run actions (Ended and Paused plan): End now and Pause while it runs,
 * Start again once it has ended, Resume now while it is paused, and Cancel pause for a
 * pause still ahead. Each posts `run_action` to `runAction`, an injected form action, so
 * the web passes a server action and the Mac a local one. Every action is undone by
 * another tap, so none asks to confirm.
 */

const EMPTY: BehaviorActionState = { status: "idle", message: "" };

export function BehaviorRunControls({
  behavior,
  runAction,
  extra,
}: Readonly<{
  behavior: BehaviorView;
  runAction: BehaviorFormAction;
  /** Shown after the run links on the same line, such as Archive on a Not running row. */
  extra?: React.ReactNode;
}>) {
  const refresh = useRefresh();
  const [pickerOpen, setPickerOpen] = useState(false);
  const todayLocalDate = localDateIn(behavior.timezone);
  const [range, setRange] = useState<PauseRange>({ fromOn: todayLocalDate, backOn: null });
  const run = useCallback<BehaviorFormAction>(async (previous, form) => {
    const result = await runAction(previous, form);
    if (result.status === "success") {
      setPickerOpen(false);
      setRange({ fromOn: localDateIn(behavior.timezone), backOn: null });
      refresh();
    }
    return result;
  }, [behavior.timezone, refresh, runAction]);
  const [state, formAction] = useActionState(run, EMPTY);
  const runState = runStateOf(behavior);
  const pauseAhead = runState === "running" && behavior.pause !== null && behavior.pause !== undefined
    && behavior.pause.backOn > todayLocalDate;

  if (runState === "archived") return null;

  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <form action={formAction} className="contents">
        <input type="hidden" name="behavior_id" value={behavior.id} />
        <input type="hidden" name="expected_updated_at" value={behavior.updatedAt} />
        {runState === "ended" ? <RunLink kind="start_again" label="Start again" /> : null}
        {runState === "paused" ? <RunLink kind="resume" label="Resume now" /> : null}
        {runState === "running" ? (
          <>
            <RunLink kind="end_now" label="End now" />
            <Dot />
            <button type="button" className="product-action product-action-primary min-h-11"
              aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
              Pause
            </button>
            {pauseAhead ? <><Dot /><RunLink kind="resume" label="Cancel pause" /></> : null}
          </>
        ) : null}
      </form>
      {extra ? <><Dot />{extra}</> : null}
      </div>

      {pickerOpen && runState === "running" ? (
        <form action={formAction} className="grid gap-3 border-l border-line pl-3">
          <input type="hidden" name="behavior_id" value={behavior.id} />
          <input type="hidden" name="expected_updated_at" value={behavior.updatedAt} />
          <input type="hidden" name="run_action" value="pause" />
          <input type="hidden" name="pause_from_on" value={range.fromOn} />
          <input type="hidden" name="pause_back_on" value={range.backOn ?? ""} />
          <PauseRangePicker label={`Pause ${behavior.title}`} value={range} todayLocalDate={todayLocalDate} onChange={setRange} />
          {pauseAhead ? <p className="text-xs text-muted-readable">This replaces the pause already set.</p> : null}
          <div className="flex flex-wrap items-center gap-x-1">
            <SaveLink disabled={!range.backOn} />
            <Dot />
            <button type="button" className="product-action product-action-secondary min-h-11"
              onClick={() => setPickerOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {/* The outcome line shows at the top of the list (the row may move groups); errors stay here. */}
      {state.status === "error" ? (
        <p role="alert" className="text-accent">{state.fieldErrors?.pause ?? state.message}</p>
      ) : null}
    </div>
  );
}

function Dot() {
  return <span aria-hidden="true" className="px-1 text-muted-readable">·</span>;
}

function RunLink({ kind, label }: Readonly<{ kind: BehaviorRunActionKind; label: string }>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="run_action" value={kind} disabled={pending}
      className="product-action product-action-primary min-h-11">
      {label}
    </button>
  );
}

function SaveLink({ disabled }: Readonly<{ disabled: boolean }>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="product-action product-action-primary min-h-11">
      {pending ? "Pausing..." : "Save pause"}
    </button>
  );
}
