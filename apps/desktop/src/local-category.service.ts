import { Temporal } from "@js-temporal/polyfill";
import { verifyCategoryDeletionReview, categorySnapshot, planCategoryChange, planCategoryRemoval, type CategoryAction } from "@cadence/core/services/category.service";
import { configurationRow } from "./local-behavior.service";
import { toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand, localMutation } from "./local-store";

export function createLocalCategoryAction(onChanged: () => void): CategoryAction {
  return async (_previous, form) => {
    try {
      const profile = await localCommand("readProfile", {});
      const categories = await localCommand("readCategories", { profileId: profile.id });
      const now = Temporal.Now.instant().toString();
      const plan = planCategoryChange(categories, form, crypto.randomUUID(), now);
      const graphs = plan.deletedId ? await localCommand("readBehaviorGraphs", { profileId: profile.id }) : [];
      verifyCategoryDeletionReview(form, graphs.map(({ behavior }) => ({ id: behavior.id, categoryId: behavior.category_id, active: behavior.active, updatedAt: behavior.updated_at })), plan.deletedId);
      const changes = planCategoryRemoval(graphs.map((graph) => toLocalBehaviorGraphRecord(graph, categories)), plan.deletedId, now);
      await localCommand("manageCategories", { ...localMutation(profile.id, now),
        expectedCategories: JSON.parse(categorySnapshot(categories)), nextCategories: plan.categories,
        updates: changes.map((change) => {
          const previous = graphs.find((graph) => graph.behavior.id === change.behaviorId)!;
          const configurationEvent = configurationRow(change.configurationEventPlan, profile.id, change.behaviorId, now);
          return { expectedRevision: previous.revision, configurationEvent, graph: { schedules: previous.schedules, slots: previous.slots,
            behavior: { ...previous.behavior, category_id: null, updated_at: now, current_configuration_event_id: configurationEvent.id } } };
        }),
      });
      onChanged();
      return { status: "success", message: "Categories saved." };
    } catch (error) {
      // Reload the list so a stale or refused change shows the stored categories. Open drafts keep their own snapshot.
      onChanged();
      return { status: "error", message: error instanceof Error ? error.message : "Unable to save categories." };
    }
  };
}
