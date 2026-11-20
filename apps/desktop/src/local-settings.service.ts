import { Temporal } from "@js-temporal/polyfill";
import { normalizeTimezoneInput, planProfileTimezoneChange } from "@cadence/core/services/settings.service";
import type { TimezoneActionState } from "../../../lib/types/settings";
import { configurationRow } from "./local-behavior.service";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand, localMutation } from "./local-store";

export async function updateLocalTimezone(value: unknown, now = Temporal.Now.instant()) {
  const timezone = normalizeTimezoneInput(value);
  const profile = await localCommand("readProfile", {});
  const profileId = profile.id;
  const state = await localCommand("readSyncState", { profileId });
  const graphs = await localCommand("readBehaviorGraphs", { profileId });
  const plans = planProfileTimezoneChange(graphs.map((graph) => toLocalBehaviorGraphRecord(graph, [])), timezone, now.toString());
  const updated = await localCommand("updateProfileTimezone", {
    ...localMutation(profileId, now.toString()), timezone, expectedTimezone: profile.timezone,
    expectedSyncVersion: state.state_version,
    updates: plans.map((plan) => {
      const previous = graphs.find(({ behavior }) => behavior.id === plan.behaviorId)!;
      const event = plan.configurationEventPlan
        ? configurationRow(plan.configurationEventPlan, profileId, plan.behaviorId, now.toString()) : null;
      const { revision, ...graph } = previous;
      return { expectedRevision: revision, configurationEvent: event,
        // Rule T1: `run` re-expresses an end or pause start that already happened.
        graph: event ? { ...graph, behavior: { ...graph.behavior, ...plan.run, timezone,
          current_configuration_event_id: event.id, updated_at: now.toString() } } : graph };
    }),
  });
  await ensureLocalOccurrencesFresh(updated, now);
  return { timezone, activeBehaviorCount: plans.length, changed: profile.timezone !== timezone };
}

export function createLocalTimezoneAction(refresh: () => void) {
  return async (_previous: TimezoneActionState, form: FormData): Promise<TimezoneActionState> => {
    try {
      const result = await updateLocalTimezone(form.get("timezone"));
      refresh();
      return { ...result, status: "success", message: result.changed ? "Timezone saved." : "Timezone confirmed." };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Unable to save timezone.", timezone: null, activeBehaviorCount: 0 };
    }
  };
}
