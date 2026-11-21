"use client";

import { useId, useState, useTransition, type ReactNode } from "react";

import { Notice } from "@/components/feedback/Notice";
import { AlertNotice } from "@/components/feedback/AlertNotice";
import type { NoticeId, NoticeParams } from "@cadence/core/notices";
import { SUB_BEHAVIOR_COUNT_FIELD, subBehaviorField } from "@/components/behaviors/sub-behavior-form-data";
import type { ParentOption } from "@/components/behaviors/behavior-list-state";
import type { BehaviorActionState, BehaviorView } from "@/lib/types/behavior";
import type { Weekday } from "@/lib/types/recurrence";

const WEEKDAYS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];
const MAX_DRAFTS = 50;
const LINE_INPUT = "min-h-8 min-w-0 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground";
const SMALL_ACTION = "product-action product-action-secondary min-h-11 text-xs sm:min-h-8";

export type SubBehaviorDraft = {
  key: string;
  title: string;
  description: string;
  inherit: boolean;
  recurrenceKind: "daily" | "weekly";
  weeklyDays: Weekday[];
  time: string;
};

type Outcome = { id: NoticeId; params?: NoticeParams } | { error: string } | null;

let draftSequence = 0;

export function newSubBehaviorDraft(): SubBehaviorDraft {
  draftSequence += 1;
  return {
    key: `sub-behavior-draft-${draftSequence}`,
    title: "",
    description: "",
    inherit: true,
    recurrenceKind: "weekly",
    weeklyDays: ["monday", "wednesday", "friday"],
    time: "09:00",
  };
}

/**
 * Drafted sub-behaviors inside a create form. The fields post with the form
 * (`sub-behavior-form-data.ts`), so web and Mac actions read the same names.
 */
export function SubBehaviorDraftEditor({
  drafts,
  onChange,
}: Readonly<{
  drafts: readonly SubBehaviorDraft[];
  onChange: (drafts: SubBehaviorDraft[]) => void;
}>) {
  const update = (key: string, patch: Partial<SubBehaviorDraft>) =>
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <fieldset className="grid gap-3 border-0 p-0" data-sub-behavior-editor="draft">
      <legend className="mb-2 text-lg leading-tight">Sub-behaviors</legend>
      <input type="hidden" name={SUB_BEHAVIOR_COUNT_FIELD} value={drafts.length} />
      {drafts.length > 0 ? (
        <ol className="grid gap-4">
          {drafts.map((draft, index) => (
            <SubBehaviorDraftRow
              key={draft.key}
              draft={draft}
              index={index}
              isFirst={index === 0}
              isLast={index === drafts.length - 1}
              onChange={(patch) => update(draft.key, patch)}
              onMove={(direction) => move(index, direction)}
              onRemove={() => onChange(drafts.filter((item) => item.key !== draft.key))}
            />
          ))}
        </ol>
      ) : null}
      <button
        type="button"
        onClick={() => onChange([...drafts, newSubBehaviorDraft()])}
        disabled={drafts.length >= MAX_DRAFTS}
        className="product-action product-action-primary justify-self-start text-sm"
      >
        Add sub-behavior
      </button>
    </fieldset>
  );
}

function SubBehaviorDraftRow({
  draft,
  index,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
}: Readonly<{
  draft: SubBehaviorDraft;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<SubBehaviorDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}>) {
  const id = useId();
  const name = (field: string) => subBehaviorField(index, field);
  const label = draft.title.trim() || `sub-behavior ${index + 1}`;

  return (
    <li className="grid gap-2 border-l border-line pl-3" data-sub-behavior-draft={index}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>Title</span>
          <input type="text" name={name("title")} value={draft.title} required maxLength={160}
            onChange={(event) => onChange({ title: event.target.value })} className={LINE_INPUT} />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Description</span>
          <input type="text" name={name("description")} value={draft.description} maxLength={1000}
            onChange={(event) => onChange({ description: event.target.value })} className={LINE_INPUT} />
        </label>
      </div>
      <input type="hidden" name={name("inherit")} value={draft.inherit ? "true" : "false"} />
      <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
        <input type="checkbox" checked={draft.inherit} onChange={(event) => onChange({ inherit: event.target.checked })}
          className="h-4 w-4 accent-[var(--primary)]" />
        Follow parent schedule
      </label>
      {draft.inherit ? null : (
        <div className="grid gap-2 text-sm sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)_minmax(6rem,8rem)] sm:items-center">
          <label className="grid gap-1">
            <span className="sr-only">Repeats</span>
            <select name={name("recurrence_kind")} value={draft.recurrenceKind} aria-label={`${label} repeats`}
              onChange={(event) => onChange({ recurrenceKind: event.target.value === "daily" ? "daily" : "weekly" })}
              className={LINE_INPUT}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          {draft.recurrenceKind === "weekly" ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label={`${label} days`}>
              {WEEKDAYS.map((weekday) => (
                <label key={weekday.value} className="inline-flex min-h-8 items-center gap-1.5 pr-1">
                  <input type="checkbox" name={name("weekly_days")} value={weekday.value}
                    checked={draft.weeklyDays.includes(weekday.value)}
                    onChange={(event) => onChange({
                      weeklyDays: event.target.checked
                        ? WEEKDAYS.map((day) => day.value).filter((day) => day === weekday.value || draft.weeklyDays.includes(day))
                        : draft.weeklyDays.filter((day) => day !== weekday.value),
                    })}
                    className="h-4 w-4 accent-[var(--primary)]" />
                  {weekday.label}
                </label>
              ))}
            </div>
          ) : <span aria-hidden="true" />}
          <label className="grid gap-1">
            <span className="sr-only" id={`${id}-time`}>{`${label} time`}</span>
            <input type="text" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="HH:MM"
              name={name("time")} value={draft.time} required aria-labelledby={`${id}-time`}
              onChange={(event) => onChange({ time: event.target.value })} className={LINE_INPUT} />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4">
        <button type="button" className={SMALL_ACTION} disabled={isFirst} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>Up</button>
        <button type="button" className={SMALL_ACTION} disabled={isLast} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>Down</button>
        <button type="button" className="product-action product-action-danger min-h-11 text-xs sm:min-h-8" onClick={onRemove} aria-label={`Remove ${label}`}>Remove</button>
      </div>
    </li>
  );
}

export type SubBehaviorManageActions = Readonly<{
  /** Saves the sibling order. Ids name every live sub-behavior once. */
  onReorder?: (orderedIds: string[]) => Promise<BehaviorActionState>;
  /** Makes one sub-behavior its own Behavior again. */
  onDetach?: (subBehavior: BehaviorView) => Promise<BehaviorActionState>;
  /** Moves an existing standalone Behavior under this parent; it follows the parent's schedule. */
  onAttach?: (behaviorId: string) => Promise<BehaviorActionState>;
  /** Creates a new sub-behavior that follows the parent's schedule. */
  onCreate?: (title: string) => Promise<BehaviorActionState>;
}>;

/**
 * The sub-behaviors of a saved parent: order, detach, and add new or existing ones.
 * Every write goes through an injected callback, so the Mac uses its local actions.
 */
export function SubBehaviorManager({
  parent,
  subBehaviors,
  candidates = [],
  actions,
}: Readonly<{
  parent: BehaviorView;
  subBehaviors: readonly BehaviorView[];
  /** Standalone Behaviors that may move under this parent. */
  candidates?: readonly ParentOption[];
  actions: SubBehaviorManageActions;
}>) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [newTitle, setNewTitle] = useState("");
  const [attachId, setAttachId] = useState("");
  const ids = subBehaviors.map((behavior) => behavior.id);

  function run(task: () => Promise<BehaviorActionState>, success: Exclude<Outcome, null | { error: string }>, after?: () => void) {
    setOutcome(null);
    // Started outside the transition so an optimistic change in the callback shows at once.
    const pendingResult = task();
    startTransition(async () => {
      try {
        const result = await pendingResult;
        if (result.status === "error") {
          setOutcome({ error: result.message });
          return;
        }
        after?.();
        setOutcome(success);
      } catch (error) {
        setOutcome({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (!actions.onReorder || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target]!, next[index]!];
    const reorder = actions.onReorder;
    run(() => reorder(next), { id: "sub-behaviors.reordered" });
  }

  return (
    <section className="grid gap-3 border-t border-line pt-4" aria-labelledby={`${id}-title`} data-sub-behavior-editor="manage">
      <h4 id={`${id}-title`} className="text-sm">Sub-behaviors</h4>
      {subBehaviors.length > 0 ? (
        <ol className="grid divide-y divide-line">
          {subBehaviors.map((behavior, index) => (
            <li key={behavior.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1 text-sm">
              <span className="min-w-0 break-words">
                {behavior.title}
                {behavior.inheritParentSchedule ? null : <span className="text-muted-readable"> · {behavior.scheduleSummary}</span>}
              </span>
              <span className="flex flex-wrap gap-x-4">
                {actions.onReorder ? (
                  <>
                    <button type="button" className={SMALL_ACTION} disabled={pending || index === 0}
                      onClick={() => move(index, -1)} aria-label={`Move ${behavior.title} up`}>Up</button>
                    <button type="button" className={SMALL_ACTION} disabled={pending || index === subBehaviors.length - 1}
                      onClick={() => move(index, 1)} aria-label={`Move ${behavior.title} down`}>Down</button>
                  </>
                ) : null}
                {actions.onDetach ? (
                  <button type="button" className={SMALL_ACTION} disabled={pending}
                    onClick={() => run(() => actions.onDetach!(behavior), { id: "sub-behaviors.detached", params: { title: behavior.title } })}
                    aria-label={`Detach ${behavior.title}`}>Detach</button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {actions.onCreate ? (
        <form
          className="flex flex-wrap items-end gap-x-4 gap-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTitle.trim();
            if (!title) return;
            run(() => actions.onCreate!(title), { id: "sub-behaviors.added", params: { title, parent: parent.title } }, () => setNewTitle(""));
          }}
        >
          <label className="grid min-w-0 flex-1 gap-1 text-sm sm:max-w-xs">
            <span>New sub-behavior</span>
            <input type="text" value={newTitle} maxLength={160} onChange={(event) => setNewTitle(event.target.value)} className={LINE_INPUT} />
          </label>
          <button type="submit" disabled={pending || !newTitle.trim()} className="product-action product-action-primary min-h-11 text-sm sm:min-h-8">Add</button>
        </form>
      ) : null}

      {actions.onAttach && candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="grid min-w-0 flex-1 gap-1 text-sm sm:max-w-xs">
            <span>Add an existing behavior</span>
            <select value={attachId} onChange={(event) => setAttachId(event.target.value)} className={LINE_INPUT}>
              <option value="">Choose a behavior</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
          <button type="button" disabled={pending || !attachId} className="product-action product-action-primary min-h-11 text-sm sm:min-h-8"
            onClick={() => {
              const title = candidates.find((candidate) => candidate.id === attachId)?.title ?? "";
              run(() => actions.onAttach!(attachId), { id: "sub-behaviors.added", params: { title, parent: parent.title } }, () => setAttachId(""));
            }}>Add</button>
        </div>
      ) : null}

      <OutcomeLine outcome={outcome} />
    </section>
  );
}

function OutcomeLine({ outcome }: Readonly<{ outcome: Outcome }>): ReactNode {
  if (!outcome) return null;
  if ("error" in outcome) {
    return <AlertNotice kind="write_refused" label={false} variant="inline" size="small">{outcome.error}</AlertNotice>;
  }
  return <Notice id={outcome.id} params={outcome.params} announce="status" className="text-sm" />;
}
