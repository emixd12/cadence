"use client";

import { useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { DesktopDraftGuard, DesktopFormDraftGuard } from "@/lib/desktop-draft";
import { useSettingsHeading, type SettingsHeadingLevel } from "@/components/settings/settings-heading";
import { CATEGORY_PANEL_PURPOSE, drawerLabel } from "@/lib/ui/settings-sections";
import { categoryAssignmentSnapshot, type CategoryAssignment, categorySnapshot, CATEGORY_NAME_LIMIT, CATEGORY_DESCRIPTION_LIMIT,
  type ManagedCategory, type CategoryAction } from "@cadence/core/services/category.service";

/** A local order shown while a move saves. It applies only while the categories still match `base`. */
type OrderDraft = { base: string; ids: readonly string[] };
type Drag = { id: string; pointerId: number; from: number };

/**
 * Ticket 304: a closed list with drag reordering. Standalone, the panel shows its title,
 * purpose and its own open button. Inside a Settings drawer that already shows the title
 * (Ticket 301), it renders only the list.
 */
export function CategoryPanel({ categories, assignments, action, headingLevel }: Readonly<{
  categories: ManagedCategory[];
  assignments: readonly CategoryAssignment[];
  action: CategoryAction;
  /** Omit to follow the surrounding group or drawer; `null` when a drawer shows the title. */
  headingLevel?: SettingsHeadingLevel | null;
}>) {
  const heading = useSettingsHeading(headingLevel);
  const [editor, setEditor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState({ status: "idle", message: "" });
  const [announcement, setAnnouncement] = useState("");
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const snapshot = categorySnapshot(categories);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const shownIds = draft?.base === snapshot && draft.ids.length === categories.length && draft.ids.every((id) => byId.has(id))
    ? draft.ids : categories.map((category) => category.id);
  const shown = shownIds.map((id) => byId.get(id)!);
  const locked = pending || editor !== null;

  function submit(form: FormData, move?: string) {
    if (!move) setAnnouncement("");
    startTransition(async () => {
      try {
        const next = await action({ status: "idle", message: "" }, form);
        // A saved move is already announced; its status line keeps the announcement.
        setResult(move && next.status === "success" ? { status: "idle", message: "" } : next);
        if (next.status !== "success") { setDraft(null); setAnnouncement(""); }
        if (next.status === "success" && !move) setEditor(null);
      } catch {
        setDraft(null); setAnnouncement("");
        setResult({ status: "error", message: "Categories could not save. Your changes are still here. Try again." });
      }
    });
  }
  function order(ids: readonly string[], id: string, to: number) {
    const next = ids.filter((item) => item !== id);
    next.splice(to, 0, id);
    return next;
  }
  function announce(id: string, to: number) {
    setAnnouncement(`${byId.get(id)!.name} moved to position ${to + 1} of ${categories.length}.`);
  }
  function save(id: string, to: number) {
    const form = new FormData();
    form.set("category_id", id); form.set("intent", "move"); form.set("position", String(to)); form.set("expected", snapshot);
    setResult({ status: "idle", message: "" });
    submit(form, id);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (locked) return;
    const from = shownIds.indexOf(id);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= shownIds.length) return;
    setDraft({ base: snapshot, ids: order(shownIds, id, to) });
    announce(id, to);
    save(id, to);
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (locked || drag || event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    setDrag({ id, pointerId: event.pointerId, from: shownIds.indexOf(id) });
    setDraft({ base: snapshot, ids: shownIds });
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-category-row]")];
    const over = rows.findIndex((row) => { const box = row.getBoundingClientRect(); return event.clientY >= box.top && event.clientY < box.bottom; });
    const to = over >= 0 ? over : event.clientY < (rows[0]?.getBoundingClientRect().top ?? 0) ? 0 : rows.length - 1;
    if (to === shownIds.indexOf(drag.id)) return;
    setDraft({ base: snapshot, ids: order(shownIds, drag.id, to) });
    announce(drag.id, to);
  }
  function onPointerEnd(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag(null);
    const to = shownIds.indexOf(drag.id);
    // A refresh during the drag replaces the list it started from; drop the drag instead of saving it.
    if (cancelled || to === drag.from || draft?.base !== snapshot) { setDraft(null); if (to !== drag.from) setAnnouncement(""); return; }
    save(drag.id, to);
  }

  const status = pending && !announcement ? "Saving categories…" : result.message || announcement;
  const content = <>
        {categories.length > 1 ? <p id="category-reorder-hint" className="text-sm leading-6 text-muted-readable">Drag a handle to reorder, or focus it and press the arrow keys.</p> : null}
        <p role={result.status === "error" ? "alert" : "status"} className="min-h-6 text-sm leading-6">{status}</p>
        {categories.length > 0 ? <ul ref={list} className="mt-2 divide-y divide-line border-y border-line">
          {shown.map((category) => <li key={category.id}>
            <div data-category-row className={["flex min-h-11 items-center gap-2", drag?.id === category.id ? "bg-surface" : ""].join(" ")}>
              {categories.length > 1 ? <button type="button" data-category-handle={category.id} aria-label={`Reorder ${category.name}`}
                aria-describedby="category-reorder-hint" aria-disabled={locked} disabled={editor !== null}
                className="grid h-11 w-8 shrink-0 cursor-grab touch-none select-none place-items-center text-muted-readable active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                onPointerDown={(event) => onPointerDown(event, category.id)} onPointerMove={onPointerMove}
                onPointerUp={(event) => onPointerEnd(event, false)} onPointerCancel={(event) => onPointerEnd(event, true)}
                onKeyDown={(event) => onKeyDown(event, category.id)}>
                <GripVertical aria-hidden="true" size={16} />
              </button> : null}
              <span className="min-w-0 flex-1 break-words text-base">{category.name}</span>
              <button type="button" aria-expanded={editor === category.id} aria-label={`Edit ${category.name}`}
                className="product-action product-action-secondary min-h-11 text-sm" disabled={pending || drag !== null || (editor !== null && editor !== category.id)}
                onClick={() => setEditor(editor === category.id ? null : category.id)}>Edit</button>
            </div>
            {editor === category.id ? <div className="pb-4 pl-10"><CategoryEditor category={category} categories={categories} pending={pending}
              assignments={assignments.filter((item) => item.categoryId === category.id)} submit={submit} cancel={() => setEditor(null)} /></div> : null}
          </li>)}
        </ul> : <p className="my-4 text-sm text-muted-readable">No categories yet. Behaviors can also use No category.</p>}
        {editor === "new" ? <CategoryEditor categories={categories} assignments={[]} pending={pending} submit={submit} cancel={() => setEditor(null)} /> :
          <button type="button" className="product-action product-action-primary mt-4 min-h-11 text-sm" disabled={pending || editor !== null || drag !== null} onClick={() => setEditor("new")}>Add category</button>}
  </>;
  if (!heading.show) {
    return <section id="categories" aria-label="Categories" aria-busy={pending}>
      <DesktopDraftGuard pending={pending} />
      {content}
    </section>;
  }
  return <section id="categories" data-settings-drawer className="bg-background py-4" aria-labelledby="categories-title" aria-busy={pending}>
    <DesktopDraftGuard pending={pending} />
    <heading.Tag id="categories-title" className="text-xl leading-tight">Categories</heading.Tag>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">{CATEGORY_PANEL_PURPOSE}</p>
    <details data-settings-row className="mt-1">
      <summary className="product-disclosure-trigger flex min-h-11 w-fit items-center text-sm">
        <span aria-hidden="true" className="product-disclosure-indicator" />
        <span className="product-disclosure-trigger-label">{drawerLabel(categories.length)}</span>
      </summary>
      <div className="pt-2">{content}</div>
    </details>
  </section>;
}

function CategoryEditor({ category, categories, assignments, pending, submit, cancel }: {
  category?: ManagedCategory; categories: ManagedCategory[]; assignments: readonly CategoryAssignment[];
  pending: boolean; submit: (form: FormData) => void; cancel: () => void;
}) {
  // Capture the exact state the editor opened against. A refresh must not rebase an unsaved draft.
  const [expected] = useState(() => categorySnapshot(categories));
  const [expectedAssignments] = useState(() => categoryAssignmentSnapshot(assignments, category?.id ?? ""));
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  return <form onChangeCapture={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); submit(new FormData(event.currentTarget)); }} className="mt-4 grid max-w-2xl gap-4">
    <DesktopFormDraftGuard dirty={dirty} onDiscard={cancel} />
    <input type="hidden" name="expected" value={expected} />
    <input type="hidden" name="expected_assignments" value={expectedAssignments} />
    <input type="hidden" name="category_id" value={category?.id ?? ""} />
    <input type="hidden" name="intent" value={deleting ? "delete" : category ? "update" : "create"} />
    <fieldset disabled={pending} className="grid min-w-0 gap-4">
      <label className="grid gap-2 text-sm">Category name
        <input name="name" defaultValue={category?.name ?? ""} required maxLength={CATEGORY_NAME_LIMIT} className="min-h-11 min-w-0 w-full border border-line bg-background px-3" />
      </label>
      <label className="grid gap-2 text-sm">Description (optional)
        <textarea name="description" defaultValue={category?.description ?? ""} rows={3} maxLength={CATEGORY_DESCRIPTION_LIMIT} className="min-w-0 w-full border border-line bg-background p-3" />
      </label>
      {deleting ? <label className="flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="confirm_delete" value="yes" required className="mt-1" />
        <span>Delete this category and move {assignments.filter((item) => item.active).length} active and {assignments.filter((item) => !item.active).length} archived Behaviors to No category. Behaviors and their history stay saved.</span>
      </label> : null}
      <div className="flex flex-wrap gap-4 text-sm">
        <button type="submit" className={`product-action min-h-11 ${deleting ? "product-action-danger" : "product-action-primary"}`}>{deleting ? "Delete category" : "Save category"}</button>
        <button type="button" className="product-action product-action-secondary min-h-11" onClick={cancel}>Cancel</button>
        {category && !deleting ? <button type="button" className="product-action product-action-danger min-h-11" onClick={() => { setDeleting(true); setDirty(true); }}>Delete category…</button> : null}
      </div>
    </fieldset>
  </form>;
}
