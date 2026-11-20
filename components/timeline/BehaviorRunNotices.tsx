"use client";

import { useActionState, useCallback, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { useRefresh } from "@cadence/ui/runtime";

import type { BehaviorRunNotice } from "@cadence/core/types/timeline";
import type { BehaviorActionState, BehaviorFormAction } from "@/lib/types/behavior";
import { formatRunDay } from "@/lib/ui/behavior-run";

/**
 * The three one-line Timeline notices for Ended and Paused Behaviors (plan answer 5A,
 * rule T7): the day an item ends ("Run ended. Start again"), the day a pause starts
 * ("Run is paused, back Dec 8. Resume now") and its back-on day ("Run is back today.").
 * The notices derive from the Behavior's fields in core (`resolveBehaviorRunNotices`);
 * nothing is stored. Closing one is remembered on this device for this day only.
 * Outcome text is italic; the action and Close are regular text (DESIGN.md).
 */

const CLOSED_KEY = "cadence.behavior-run-notices.closed.v1";

export function noticeKey(notice: Pick<BehaviorRunNotice, "behaviorId" | "kind">, todayLocalDate: string): string {
  return `${todayLocalDate}:${notice.behaviorId}:${notice.kind}`;
}

const CLOSED_EVENT = "cadence:behavior-run-notices-closed";

function rawClosed(): string {
  try { return window.localStorage.getItem(CLOSED_KEY) ?? "[]"; } catch { return "[]"; }
}

function subscribeClosed(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CLOSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CLOSED_EVENT, onChange);
  };
}

function parseClosed(raw: string, todayLocalDate: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(raw);
    return new Set(Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === "string" && key.startsWith(`${todayLocalDate}:`))
      : []);
  } catch {
    return new Set();
  }
}

function writeClosed(keys: ReadonlySet<string>) {
  // Only today's keys are kept, so the list never grows past one day's notices.
  try { window.localStorage.setItem(CLOSED_KEY, JSON.stringify([...keys])); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(CLOSED_EVENT));
}

export function behaviorRunNoticeText(notice: BehaviorRunNotice, todayLocalDate: string): string {
  if (notice.kind === "ended") return `${notice.title} ended.`;
  if (notice.kind === "paused") {
    return notice.backOn ? `${notice.title} is paused, back ${formatRunDay(notice.backOn, todayLocalDate)}.` : `${notice.title} is paused.`;
  }
  return `${notice.title} is back today.`;
}

export function BehaviorRunNotices({
  notices,
  todayLocalDate,
  runAction,
}: Readonly<{
  notices: readonly BehaviorRunNotice[] | undefined;
  todayLocalDate: string;
  /** Start again and Resume now. Without it the notices show text and Close only. */
  runAction?: BehaviorFormAction;
}>) {
  const raw = useSyncExternalStore(subscribeClosed, rawClosed, () => "[]");
  const closed = parseClosed(raw, todayLocalDate);
  const visible = (notices ?? []).filter((notice) => !closed.has(noticeKey(notice, todayLocalDate)));
  if (visible.length === 0) return null;

  function close(notice: BehaviorRunNotice) {
    const next = parseClosed(rawClosed(), todayLocalDate);
    next.add(noticeKey(notice, todayLocalDate));
    writeClosed(next);
  }

  return (
    <ul aria-label="Behaviors not running" className="grid gap-1 border-b border-line pb-4 text-sm">
      {visible.map((notice) => (
        <RunNoticeLine key={noticeKey(notice, todayLocalDate)} notice={notice} todayLocalDate={todayLocalDate}
          runAction={runAction} onClose={() => close(notice)} />
      ))}
    </ul>
  );
}

const EMPTY: BehaviorActionState = { status: "idle", message: "" };

function RunNoticeLine({
  notice,
  todayLocalDate,
  runAction,
  onClose,
}: Readonly<{
  notice: BehaviorRunNotice;
  todayLocalDate: string;
  runAction?: BehaviorFormAction;
  onClose: () => void;
}>) {
  const refresh = useRefresh();
  const run = useCallback<BehaviorFormAction>(async (previous, form) => {
    if (!runAction) return EMPTY;
    const result = await runAction(previous, form);
    if (result.status === "success") refresh();
    return result;
  }, [refresh, runAction]);
  const [state, formAction] = useActionState(run, EMPTY);

  const action = notice.kind === "ended" ? { kind: "start_again", label: "Start again" }
    : notice.kind === "paused" ? { kind: "resume", label: "Resume now" } : null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      {state.status === "success" ? (
        <span className="italic" role="status">{state.message}</span>
      ) : (
        <>
          <span className="italic">{behaviorRunNoticeText(notice, todayLocalDate)}</span>
          {action && runAction ? (
            <form action={formAction} className="contents">
              <input type="hidden" name="behavior_id" value={notice.behaviorId} />
              <input type="hidden" name="expected_updated_at" value={notice.updatedAt} />
              <input type="hidden" name="run_action" value={action.kind} />
              <NoticeAction label={action.label} />
            </form>
          ) : null}
        </>
      )}
      <button type="button" onClick={onClose} aria-label={`Close notice about ${notice.title}`}
        className="-my-2 py-2 text-xs text-muted-readable underline underline-offset-2 hover:text-foreground">
        Close
      </button>
      {state.status === "error" ? <span role="alert" className="basis-full text-accent">{state.message}</span> : null}
    </li>
  );
}

function NoticeAction({ label }: Readonly<{ label: string }>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="-my-2 py-2 underline underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60">
      {label}
    </button>
  );
}
