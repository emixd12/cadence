"use client";

import { useState, useTransition } from "react";
import { DesktopDraftGuard, DesktopFormDraftGuard } from "@/lib/desktop-draft";
import { settingsHeadingTag, useSettingsHeading, type SettingsHeadingLevel } from "@/components/settings/settings-heading";
import { categoryAssignmentSnapshot, type CategoryAssignment, categorySnapshot, CATEGORY_NAME_LIMIT, CATEGORY_DESCRIPTION_LIMIT,
  type ManagedCategory, type CategoryAction } from "@cadence/core/services/category.service";

export const CATEGORY_PANEL_PURPOSE = "Organize Behaviors with your own categories. Descriptions provide context in forms and exports.";

export function CategoryPanel({ categories, assignments, action, headingLevel }: Readonly<{
  categories: ManagedCategory[];
  assignments: readonly CategoryAssignment[];
  action: CategoryAction;
  /** Ticket 301: omit to follow the surrounding group or drawer; `null` when a drawer shows the title. */
  headingLevel?: SettingsHeadingLevel | null;
}>) {
  const heading = useSettingsHeading(headingLevel);
  const ItemHeading = settingsHeadingTag(heading.childLevel);
  const [editor, setEditor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState({ status: "idle", message: "" });
  function submit(form: FormData) {
    startTransition(async () => {
      try {
        const next = await action({ status: "idle", message: "" }, form);
        setResult(next);
        if (next.status === "success") setEditor(null);
      } catch { setResult({ status: "error", message: "Unable to save categories. Your draft is unchanged. Try again." }); }
    });
  }
  function move(id: string, intent: string) {
    const form = new FormData();
    form.set("category_id", id); form.set("intent", intent); form.set("expected", categorySnapshot(categories));
    submit(form);
  }
  return <section id="categories" className={heading.show ? "bg-background py-4" : "bg-background"} aria-labelledby={heading.show ? "categories-title" : undefined}
    aria-label={heading.show ? undefined : "Categories"} aria-busy={pending}>
    <DesktopDraftGuard pending={pending} />
    {heading.show ? <heading.Tag id="categories-title" className="text-xl leading-tight">Categories</heading.Tag> : null}
    {/* A drawer that shows the title also shows this purpose line. */}
    {heading.show ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">{CATEGORY_PANEL_PURPOSE}</p> : null}
    <p role={result.status === "error" ? "alert" : "status"} className="mt-3 text-sm">{pending ? "Saving categories…" : result.message}</p>
    <div className="mt-4 divide-y divide-line">
      {categories.map((category, index) => <div key={category.id} className="py-3">
        <ItemHeading className="break-words text-lg">{category.name}</ItemHeading>
        {category.description ? <p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm text-muted-readable">{category.description}</p> : null}
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <button type="button" className="product-action product-action-primary min-h-11 min-w-0 max-w-full break-words text-left" disabled={pending || editor !== null} onClick={() => setEditor(category.id)}>Edit {category.name}</button>
          <button type="button" className="product-action product-action-secondary min-h-11" aria-label={`Move ${category.name} up`} disabled={pending || editor !== null || index === 0} onClick={() => move(category.id, "up")}>Move up</button>
          <button type="button" className="product-action product-action-secondary min-h-11" aria-label={`Move ${category.name} down`} disabled={pending || editor !== null || index === categories.length - 1} onClick={() => move(category.id, "down")}>Move down</button>
        </div>
        {editor === category.id ? <CategoryEditor category={category} categories={categories} pending={pending}
          assignments={assignments.filter((item) => item.categoryId === category.id)} submit={submit} cancel={() => setEditor(null)} /> : null}
      </div>)}
    </div>
    {categories.length === 0 ? <p className="my-4 text-sm text-muted-readable">No categories yet. Behaviors can also use No category.</p> : null}
    {editor === "new" ? <CategoryEditor categories={categories} assignments={[]} pending={pending} submit={submit} cancel={() => setEditor(null)} /> :
      <button type="button" className="product-action product-action-primary mt-4 min-h-11 text-sm" disabled={pending || editor !== null} onClick={() => setEditor("new")}>Add category</button>}
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
