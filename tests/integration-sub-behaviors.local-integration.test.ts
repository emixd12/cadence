import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { Database } from "@/lib/db/database.types";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { parseIntegrationSigningKey } from "@/lib/supabase/integration-token";
import { registerOAuthClient, approveOAuthConsent } from "@/lib/db/oauth.repo";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import { readOperationHandlers } from "@/lib/integrations/operations/read";
import { validateOperationOutput, type IntegrationOperationOutput } from "@cadence/core/integration";

/**
 * Contract 1.7.0 end to end on the local stack: a parent and its sub-behaviors in one
 * create, the Timeline's parent slots, a whole-slot mark, grouping, reordering, depth-1
 * refusals and archive of a parent.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;
const at = (time: string) => [{ recurrence: { frequency: "daily" as const, interval: 1 }, time_entries: [{ kind: "exact" as const, start_time: time }] }];

localDescribe("sub-behavior MCP writes on isolated local Supabase", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let a: IntegrationContext;
  let userId: string;
  let parent: IntegrationOperationOutput<"create_behavior">["behavior"];
  let tomorrow: string;
  const clientId = `dcr-sub-behaviors-${randomUUID()}`;

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local writes require loopback.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "Sub-behavior test", clientUri: null,
      logoUri: null, redirectUris: ["https://client.example/callback"], applicationType: "web", metadata: {},
      verifiedClient: null, metadataExpiresAt: null });
    const created = await admin.auth.admin.createUser({ email: `sub-${randomUUID()}@example.test`, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create local fixture user.");
    userId = created.data.user.id;
    const grant = { userId, grantId: randomUUID(), clientId, clientLabel: "Sub-behavior test", channel: "mcp" as const,
      scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] as const };
    const options = { now: new Date(), signingKey: parseIntegrationSigningKey(signingKey!), runtimeConfig: { url: url!, publishableKey: publishableKey! } };
    const consent = await approveOAuthConsent(createIntegrationContext(grant, options).supabase, { clientId,
      redirectUri: "https://client.example/callback", codeChallenge: "a".repeat(43), resource: "https://app.cadence-me.com/mcp",
      scopes: [...grant.scopes], codeHash: randomUUID().replaceAll("-", "").repeat(2) });
    a = createIntegrationContext({ ...grant, grantId: consent.grantId }, options);
    tomorrow = Temporal.Now.plainDateISO("America/New_York").add({ days: 1 }).toString();
  }, 30_000);
  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("creates a parent and its sub-behaviors in one call and replays it exactly", async () => {
    const input = {
      title: "Skin routine", schedules: at("21:30"), external_ref: "app:routine", idempotency_key: "sub-create-0001",
      sub_behaviors: [
        { title: "Cleanser", external_ref: "app:cleanser" }, { title: "Moisturizer" },
        { title: "Retinol", inherit_parent_schedule: false, schedules: at("22:15") },
      ],
    };
    const first = await writeOperationHandlers.create_behavior(a, input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) return;
    expect(validateOperationOutput("create_behavior", first.value).ok).toBe(true);
    parent = first.value.behavior;
    expect(parent.sub_behaviors.map((row) => [row.title, row.inherit_parent_schedule])).toEqual([
      ["Cleanser", true], ["Moisturizer", true], ["Retinol", false],
    ]);
    expect(first.value.sub_behaviors?.map((row) => row.external_ref)).toEqual(["app:cleanser", null, null]);
    expect(first.value.sub_behaviors?.[0]?.schedules[0]?.time_entries[0]?.start_time).toBe("21:30");
    expect(await writeOperationHandlers.create_behavior(a, input)).toEqual(first);
    const { data } = await a.supabase.from("behaviors").select("id");
    expect(data).toHaveLength(4);
  });

  it("refuses nesting and unknown parents", async () => {
    const child = parent.sub_behaviors[0]!;
    expect(await writeOperationHandlers.create_behavior(a, { title: "Rinse", parent_behavior_id: child.id }))
      .toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(await writeOperationHandlers.create_behavior(a, { title: "Rinse", parent_behavior_id: randomUUID() }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
    const { data } = await a.supabase.from("behaviors").select("updated_at").eq("id", parent.id).single();
    const other = await writeOperationHandlers.create_behavior(a, { title: "Evening", schedules: at("20:00") });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(await writeOperationHandlers.update_behavior(a, {
      behavior_id: parent.id, expected_revision: Temporal.Instant.from(data!.updated_at).toString(), parent_behavior_id: other.value.behavior.id,
    })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("shows parent slots on the Timeline and marks one slot in one change", async () => {
    const timeline = await readOperationHandlers.get_timeline(a, { start_local_date: tomorrow, include_needs_decision: false });
    expect(timeline.ok, JSON.stringify(timeline)).toBe(true);
    if (!timeline.ok) return;
    const groups = timeline.value.days[0]!.parent_groups!.filter((group) => group.parent_behavior_id === parent.id);
    expect(groups.map((group) => [group.total_count, group.derived_status])).toEqual([[2, "unresolved"], [1, "unresolved"]]);
    const day = timeline.value.days[0]!.occurrences.filter((row) => row.parent_behavior_id === parent.id);
    expect(day.every((row) => row.parent_title === "Skin routine")).toBe(true);

    expect(await writeOperationHandlers.set_parent_occurrence_status(a, { parent_behavior_id: parent.id, local_date: tomorrow, status: "completed" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const input = { parent_behavior_id: parent.id, local_date: tomorrow, slot_key: groups[0]!.slot_key, status: "completed" as const,
      idempotency_key: "sub-mark-0001" };
    const marked = await writeOperationHandlers.set_parent_occurrence_status(a, input);
    expect(marked.ok, JSON.stringify(marked)).toBe(true);
    if (!marked.ok) return;
    expect(marked.value.changed_occurrence_ids).toHaveLength(2);
    expect(marked.value.parent_groups).toMatchObject([{ derived_status: "completed", progress_label: "2/2" }]);
    expect(marked.value.occurrences.map((row) => row.behavior_title)).toEqual(["Cleanser", "Moisturizer"]);
    expect(await writeOperationHandlers.set_parent_occurrence_status(a, input)).toEqual(marked);
    const again = await writeOperationHandlers.set_parent_occurrence_status(a, { ...input, idempotency_key: undefined });
    expect(again).toMatchObject({ ok: true, value: { changed: false, changed_occurrence_ids: [] } });
  });

  it("adds a following step, moves it first, and filters by hierarchy", async () => {
    const added = await writeOperationHandlers.create_behavior(a, { title: "Sunscreen", parent_behavior_id: parent.id });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    if (!added.ok) return;
    expect(added.value.behavior).toMatchObject({ parent_behavior_id: parent.id, inherit_parent_schedule: true, sub_behavior_sort_order: 3 });
    const moved = await writeOperationHandlers.update_behavior(a, {
      behavior_id: added.value.behavior.id, expected_revision: added.value.behavior.revision, sub_behavior_sort_order: 0,
    });
    expect(moved).toMatchObject({ ok: true, value: { changed: true, behavior: { sub_behavior_sort_order: 0 } } });
    const top = await readOperationHandlers.list_behaviors(a, { hierarchy: "top_level" });
    expect(top.ok && top.value.behaviors.map((row) => row.title).sort()).toEqual(["Evening", "Skin routine"]);
    const steps = await readOperationHandlers.list_behaviors(a, { parent_behavior_id: parent.id });
    expect(steps.ok && steps.value.behaviors.length).toBe(4);
    const read = await readOperationHandlers.get_behavior(a, { behavior_id: parent.id });
    expect(read.ok && read.value.behavior.sub_behaviors.map((row) => row.title)).toEqual(["Sunscreen", "Cleanser", "Moisturizer", "Retinol"]);
  });

  it("edits and archives a parent together with its sub-behaviors", async () => {
    const read = await readOperationHandlers.get_behavior(a, { behavior_id: parent.id });
    if (!read.ok) throw new Error("read failed");
    const renamed = await writeOperationHandlers.update_behavior(a, {
      behavior_id: parent.id, expected_revision: read.value.behavior.revision, title: "Night routine",
    });
    expect(renamed).toMatchObject({ ok: true, value: { changed: true, behavior: { title: "Night routine" } } });
    const archived = await writeOperationHandlers.archive_behavior(a, { behavior_id: parent.id, idempotency_key: "sub-archive-0001" });
    expect(archived.ok, JSON.stringify(archived)).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.behavior.state).toBe("archived");
    expect(archived.value.behavior.sub_behaviors.every((row) => !row.active)).toBe(true);
    expect(await writeOperationHandlers.archive_behavior(a, { behavior_id: parent.id }))
      .toMatchObject({ ok: true, value: { changed: false } });
  });
});
