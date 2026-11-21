import type { BehaviorDataStore } from "@cadence/core/behavior-store";
import { getBehaviorById, listUserBehaviors, type AppSupabaseClient } from "./behaviors.repo";
import {
  createBehaviorGroupWithAtomicScheduleGraphs,
  createBehaviorWithAtomicScheduleGraph,
  reorderSubBehaviors,
  updateBehaviorGroupWithAtomicScheduleGraphs,
  updateBehaviorWithAtomicScheduleGraph,
} from "./behaviorDefinitionEvents.repo";

export function createBehaviorStore(supabase: AppSupabaseClient, userId: string): BehaviorDataStore {
  return {
    getBehaviorById: (id) => getBehaviorById(supabase, userId, id),
    createBehaviorWithAtomicScheduleGraph: (input) => createBehaviorWithAtomicScheduleGraph(supabase, input),
    updateBehaviorWithAtomicScheduleGraph: (input) => updateBehaviorWithAtomicScheduleGraph(supabase, input),
    listBehaviors: () => listUserBehaviors(supabase, userId),
    createBehaviorGroupWithAtomicScheduleGraphs: (input) => createBehaviorGroupWithAtomicScheduleGraphs(supabase, input),
    updateBehaviorGroupWithAtomicScheduleGraphs: (input) => updateBehaviorGroupWithAtomicScheduleGraphs(supabase, input),
    reorderSubBehaviors: (input) => reorderSubBehaviors(supabase, input),
  };
}
