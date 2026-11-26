/** @jsxImportSource preact */
// The "Cadence day" view (Ticket 377, docs/DECISIONS.md D36). It renders what `show_day`
// returned and nothing else: no recurrence, grouping, adherence or date logic lives here.
// Every piece of the person's text is a JSX text child, so it can never become markup.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { Bridge, DayOccurrence, DayParentGroup, ResolvedStatus, ToolResult } from "./contract";
import { dayLabel, timeLabel } from "./format";
import { createWriter, groupKey, INITIAL_STATE, receiveDayResult, rows, statusAfterClick, type ViewState, type Write } from "./model";
import { LABELS, notice, noticeLabel, STATUS_LABELS } from "./strings";

export type ConnectHost = (handlers: {
  onDayResult(result: ToolResult): void;
  onCancelled(): void;
}) => Promise<Bridge>;

type Props = Readonly<{ connect: ConnectHost }>;

const SKELETON_ROWS = [0, 1, 2];

export function DayView({ connect }: Props) {
  const [state, setState] = useState<ViewState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  // The latest state for event handlers, which outlive the render that made them.
  const stateRef = useRef<ViewState>(INITIAL_STATE);
  const inFlightRef = useRef(false);
  const bridgeRef = useRef<Bridge | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const performWrite = useMemo(() => createWriter(), []);

  const commit = (next: ViewState) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    let active = true;
    connect({
      onDayResult: (result) => { if (active) commit(receiveDayResult(stateRef.current, result)); },
      onCancelled: () => { if (active && !stateRef.current.day) commit({ ...stateRef.current, phase: "unavailable" }); },
    }).then(
      (connected) => { bridgeRef.current = connected; },
      () => { if (active) commit({ ...stateRef.current, phase: "unavailable" }); },
    );
    return () => {
      active = false;
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    };
  }, [connect]);

  useEffect(() => {
    if (noteFor) editorRef.current?.focus();
  }, [noteFor]);

  // The editor grows with its text, so a long note never scrolls inside the view.
  useEffect(() => {
    const field = editorRef.current;
    if (!noteFor || !field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [noteFor, draft]);

  const send = async (write: Write) => {
    if (!bridgeRef.current || inFlightRef.current || waiting) return;
    inFlightRef.current = true;
    setBusy(true);
    const result = await performWrite(bridgeRef.current, stateRef.current, write);
    inFlightRef.current = false;
    setBusy(false);
    commit(result.state);
    if (write.tool === "update_occurrence_note" && result.outcome === "saved") setNoteFor(null);
    if (result.outcome === "reconnect") setNoteFor(null);
    if (result.outcome === "rate_limited") {
      // Honor the server's wait: controls stay off until it ends, then the notice leaves.
      setWaiting(true);
      waitTimerRef.current = setTimeout(() => {
        setWaiting(false);
        if (stateRef.current.notice?.id === "day-view.rate-limited") commit({ ...stateRef.current, notice: null });
      }, (result.retryAfterSeconds ?? 60) * 1000);
    }
  };

  const { day, canWrite, phase } = state;
  const readOnly = canWrite === false;
  const disabled = busy || waiting;

  if (!day) {
    return (
      <main className="day">
        {phase === "unavailable" ? (
          <p className="alert" role="alert" data-notice="day-view.unavailable">{notice("day-view.unavailable")}</p>
        ) : (
          <div data-loading>
            <p className="visually-hidden" role="status">{notice("day-view.loading")}</p>
            <ul className="rows" aria-hidden="true">
              {SKELETON_ROWS.map((row) => <li className="row skeleton" key={row}><span /><span /></li>)}
            </ul>
          </div>
        )}
      </main>
    );
  }

  const openNote = (occurrence: DayOccurrence) => {
    setDraft(occurrence.note ?? "");
    setNoteFor(occurrence.id);
    if (stateRef.current.noteConflictFor) commit({ ...stateRef.current, noteConflictFor: null });
  };

  const statusButton = (occurrence: DayOccurrence, status: ResolvedStatus, label: string) => (
    <button type="button" className="action" disabled={disabled} aria-pressed={occurrence.status === status}
      aria-label={`${label}, ${occurrence.behavior_title}`} data-action={status}
      onClick={() => void send({ tool: "set_occurrence_status", occurrence, status: statusAfterClick(occurrence, status) })}>
      {label}
    </button>
  );

  const occurrenceRow = (occurrence: DayOccurrence) => {
    const editing = noteFor === occurrence.id && !readOnly;
    const facts: string[] = [];
    if (occurrence.status !== "unresolved") facts.push(occurrence.status_label);
    // A connector completion is labelled from the server's provenance, never as the person's mark.
    if (occurrence.connector_completion) facts.push(notice("day-view.from-source", { source: occurrence.connector_completion.source_label }));
    if (occurrence.origin === "opportunity") facts.push(notice("day-view.added", { source: occurrence.added_by ?? "other" }));
    if (occurrence.alongside === true) facts.push(notice("day-view.alongside"));
    return (
      <li className="row" key={occurrence.id} data-occurrence={occurrence.id} data-status={occurrence.status}>
        <div className="row-main">
          <div className="row-text">
            <span className="time">{timeLabel(occurrence)}</span>
            <span className="title">{occurrence.behavior_title}</span>
            {facts.length > 0 ? <span className="facts" data-facts>{facts.join(" · ")}</span> : null}
          </div>
          {readOnly ? null : (
            <div className="actions">
              {statusButton(occurrence, "completed", LABELS.completed)}
              {statusButton(occurrence, "not_completed", LABELS.notCompleted)}
              <button type="button" className="action" disabled={disabled} aria-expanded={editing} data-action="note"
                aria-label={`${LABELS.note}, ${occurrence.behavior_title}`} onClick={() => (editing ? setNoteFor(null) : openNote(occurrence))}>
                {LABELS.note}
              </button>
            </div>
          )}
        </div>
        {occurrence.note && !editing ? <p className="note user-text" data-note>{occurrence.note}</p> : null}
        {editing ? (
          <div className="editor" data-note-editor>
            {state.noteConflictFor === occurrence.id ? (
              <div data-note-current>
                <p className="muted">{notice("day-view.note-current")}</p>
                <p className="note user-text">{occurrence.note ?? ""}</p>
              </div>
            ) : null}
            <textarea ref={editorRef} rows={3} value={draft} aria-label={`${LABELS.note}, ${occurrence.behavior_title}`}
              onInput={(event) => setDraft(event.currentTarget.value)} />
            <div className="actions">
              <button type="button" className="action" disabled={disabled} data-action="save-note"
                onClick={() => void send({ tool: "update_occurrence_note", occurrence, note: draft })}>
                {LABELS.saveNote}
              </button>
              <button type="button" className="action" disabled={busy} data-action="cancel-note" onClick={() => setNoteFor(null)}>
                {LABELS.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const groupRow = (group: DayParentGroup, children: readonly DayOccurrence[]) => {
    const key = groupKey(group);
    const expanded = openGroups.has(key);
    const toggle = () => setOpenGroups((open) => {
      const next = new Set(open);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });
    // The slot's status and progress are the server's derived values.
    const progress = group.derived_status === "completed" || group.derived_status === "not_completed"
      ? STATUS_LABELS[group.derived_status]
      : group.progress_label;
    const slotButton = (status: ResolvedStatus, label: string) => (
      <button type="button" className="action" disabled={disabled || group.derived_status === status} aria-pressed={group.derived_status === status}
        aria-label={`${label}, ${group.title}`} data-action={status}
        onClick={() => void send({ tool: "set_parent_occurrence_status", group, children, status })}>
        {label}
      </button>
    );
    return (
      <li className="row" key={key} data-group={group.parent_behavior_id} data-status={group.derived_status}>
        <div className="row-main">
          <button type="button" className="disclosure" aria-expanded={expanded} data-action="steps" onClick={toggle}>
            <span className="triangle" aria-hidden="true" />
            <span className="row-text">
              <span className="time">{group.scheduled_time_label}</span>
              <span className="title">{group.title}</span>
              <span className="facts inline" data-progress>{progress}</span>
            </span>
            <span className="visually-hidden">{expanded ? LABELS.hideSteps : LABELS.showSteps}</span>
          </button>
          {readOnly ? null : (
            <div className="actions">
              {slotButton("completed", LABELS.completed)}
              {slotButton("not_completed", LABELS.notCompleted)}
            </div>
          )}
        </div>
        {expanded ? <ul className="rows steps">{children.map(occurrenceRow)}</ul> : null}
      </li>
    );
  };

  const list = rows(day);
  const banner = (id: Parameters<typeof notice>[0], params?: Parameters<typeof notice>[1]): ComponentChildren => {
    const label = noticeLabel(id);
    return <p className="alert" role="alert" data-notice={id}>{label ? `${label}. ` : ""}{notice(id, params)}</p>;
  };

  return (
    <main className="day" aria-busy={busy}>
      <header className="heading">
        <h1>{day.is_today ? LABELS.today : dayLabel(day)}</h1>
        {day.is_today ? <p className="muted">{dayLabel(day)}</p> : null}
      </header>
      {day.day_note ? (
        <section className="day-note" data-day-note>
          <h2 className="label">{LABELS.dayNote}</h2>
          <p className="user-text">{day.day_note}</p>
        </section>
      ) : null}
      {day.needs_decision.count > 0 ? (
        <p className="muted" data-needs-decision>
          {notice("day-view.needs-decision", { count: day.needs_decision.count, truncated: day.needs_decision.truncated ? "yes" : "no" })}
        </p>
      ) : null}
      {readOnly ? <p className="muted" data-reconnect>{notice("day-view.reconnect")}</p> : null}
      {state.notice ? banner(state.notice.id, state.notice.seconds === undefined ? undefined : { seconds: state.notice.seconds }) : null}
      {list.length === 0 ? (
        <p className="muted" data-empty>{notice("day-view.empty")}</p>
      ) : (
        <ul className="rows">{list.map((row) => (row.kind === "group" ? groupRow(row.group, row.children) : occurrenceRow(row.occurrence)))}</ul>
      )}
    </main>
  );
}
