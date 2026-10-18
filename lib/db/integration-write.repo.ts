import type { AppSupabaseClient, BehaviorWithCategory } from "./behaviors.repo";
import type { Json } from "./database.types";
import type { Occurrence } from "@/lib/types/database";

export type IntegrationWriteSnapshot = {
  version: 1;
  rpc_result: Json;
  behavior: BehaviorWithCategory;
  occurrence: Occurrence | null;
  previous_status: Occurrence["status"] | null;
  changed: boolean;
  as_of: string;
  timezone: string;
  external_ref: string | null;
};

export function readIntegrationWriteSnapshot(value: unknown): IntegrationWriteSnapshot {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("behavior" in value) || !value.behavior || !("changed" in value) || typeof value.changed !== "boolean") {
    throw new Error("Invalid integration write receipt.");
  }
  return value as IntegrationWriteSnapshot;
}

/** Intercepts only the existing product transactions; reads and repair RPCs keep their normal client. */
export function createIntegrationWriteClient(
  supabase: AppSupabaseClient,
  input: { operation: string; key?: string; hash: string; asOf: string; externalRef?: string },
) {
  let snapshot: IntegrationWriteSnapshot | undefined;
  async function execute(rpc: string, args: unknown) {
    const { data, error } = await supabase.rpc("integration_apply_write", {
      p_operation: input.operation, p_key: (input.key ?? null) as string, p_hash: input.hash,
      p_rpc: rpc, p_args: args as Json, p_as_of: input.asOf, p_external_ref: input.externalRef,
    });
    if (error) throw error;
    snapshot = readIntegrationWriteSnapshot(data);
    return snapshot.rpc_result;
  }
  const intercepted = new Set([
    "create_behavior_with_schedule_graph", "update_behavior_with_schedule_graph", "apply_occurrence_status_transition",
  ]);
  const client = new Proxy(supabase, {
    get(target, property) {
      if (property === "rpc") return (name: string, args: unknown) => {
        if (!intercepted.has(name)) return target.rpc(name as never, args as never);
        return execute(name, args).then(data => ({ data, error: null }), error => ({ data: null, error }));
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { client, execute, getSnapshot: () => snapshot };
}
