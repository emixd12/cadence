import type { BehaviorGraphRecord } from "../behavior-store";
import { planBehaviorConfigurationChangeEvent } from "../resolvers/behavior-configuration.resolver";
import { toBehaviorConfigurationSnapshot, toStoredBehaviorScheduleGraph } from "./behavior.service";

export type ManagedCategory = { id: string; name: string; description?: string | null; sort_order: number; updated_at: string };
export type CategoryActionState = { status: "idle" | "success" | "error"; message: string };
export type CategoryAction = (previous: CategoryActionState, form: { get(name: string): unknown }) => Promise<CategoryActionState>;
export const CATEGORY_NAME_LIMIT = 120;
export const CATEGORY_DESCRIPTION_LIMIT = 2000;
export const normalizeCategoryName = (name: string) => name.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// ponytail: full category snapshots cap edits at 1,000 categories; use per-row plans if accounts outgrow this.
export function categorySnapshot(categories: readonly ManagedCategory[]) {
  return JSON.stringify([...categories].sort((a, b) => a.id.localeCompare(b.id)).map((category) => ({
    id: category.id, name: category.name, description: category.description ?? null,
    sort_order: category.sort_order, updated_at: category.updated_at,
  })));
}

export function planCategoryChange(categories: readonly ManagedCategory[], form: { get(name: string): unknown }, newId: string, now: string) {
  if (form.get("expected") !== categorySnapshot(categories)) throw new Error("Categories changed. Refresh Settings and review your changes.");
  const operation = form.get("intent");
  const id = form.get("category_id");
  const rows = categories.map((category) => ({ ...category, description: category.description ?? null }));
  const index = rows.findIndex((category) => category.id === id);
  if (operation !== "create" && index === -1) throw new Error("Choose an existing category.");
  let deletedId: string | null = null;
  if (operation === "create" || operation === "update") {
    const rawName = form.get("name");
    const rawDescription = form.get("description");
    if (typeof rawName !== "string" || (rawDescription != null && typeof rawDescription !== "string")) throw new Error("Enter plain text for the category name and description.");
    const name = rawName.trim();
    const description = typeof rawDescription === "string" ? rawDescription.trim() || null : null;
    if (!name || Array.from(name).length > CATEGORY_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Enter a category name of 1–120 characters without control characters.");
    if (description && (Array.from(description).length > CATEGORY_DESCRIPTION_LIMIT || description.includes("\0"))) throw new Error("Keep the description within 2,000 characters.");
    if (rows.some((category) => category.id !== id && normalizeCategoryName(category.name) === normalizeCategoryName(name))) throw new Error("A category with this name already exists.");
    if (operation === "create") rows.push({ id: newId, name, description, sort_order: rows.length, updated_at: now });
    else rows[index] = { ...rows[index]!, name, description, updated_at: now };
  } else if (operation === "delete") {
    if (form.get("confirm_delete") !== "yes") throw new Error("Confirm deletion before removing a category.");
    deletedId = rows[index]!.id;
    rows.splice(index, 1);
  } else if (operation === "move") {
    // `position` is the category's zero-based place in the list after the move.
    const raw = form.get("position");
    const position = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : -1;
    if (position < 0 || position >= rows.length) throw new Error("Choose a position in the category list.");
    const [moved] = rows.splice(index, 1);
    rows.splice(position, 0, moved!);
  } else throw new Error("Choose a category action.");
  return { deletedId, categories: rows.map((category, index) => ({ ...category, sort_order: index,
    updated_at: category.sort_order === index ? category.updated_at : now })) };
}

export function planCategoryRemoval(behaviors: readonly BehaviorGraphRecord[], categoryId: string | null, now: string) {
  return behaviors.filter((behavior) => categoryId !== null && behavior.category_id === categoryId).map((behavior) => {
    const previous = toBehaviorConfigurationSnapshot(behavior, toStoredBehaviorScheduleGraph(behavior));
    return { behaviorId: behavior.id, expectedUpdatedAt: behavior.updated_at,
      configurationEventPlan: planBehaviorConfigurationChangeEvent({ previousConfiguration: previous,
        nextConfiguration: { ...previous, categoryId: null }, recordedAt: now, effectiveAt: now,
        source: "manual", reasonCode: "category_changed" })! };
  });
}

export type CategoryAssignment = { id: string; categoryId: string | null; active: boolean; updatedAt: string };
export function categoryAssignmentSnapshot(assignments: readonly CategoryAssignment[], categoryId: string) {
  return JSON.stringify(assignments.filter((row) => row.categoryId === categoryId)
    .map(({ id, active, updatedAt }) => ({ id, active, updatedAt })).sort((a, b) => a.id.localeCompare(b.id)));
}
export function verifyCategoryDeletionReview(form: { get(name: string): unknown }, assignments: readonly CategoryAssignment[], categoryId: string | null) {
  if (categoryId && form.get("expected_assignments") !== categoryAssignmentSnapshot(assignments, categoryId)) {
    throw new Error("Category assignments changed. Cancel and reopen the editor before deleting.");
  }
}
