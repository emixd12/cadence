import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { travelEventRef } from "@cadence/core/services/travel-habits";
import type { Database } from "@/lib/db/database.types";
import { getTravelSettings, readTravelRouteSource, saveTravelHabits, saveTravelSettings } from "@/lib/services/travel-settings.service";

// Ticket 217 opt-in check of the hosted habit columns, the habit-revision compare,
// owner RLS and the account-sync read against a loopback Supabase. It creates and
// deletes two users and calls no provider.
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localDescribe = localUrl && localServiceKey && localPublishableKey ? describe : describe.skip;

localDescribe("Learned travel habits against local Supabase", () => {
  let admin: SupabaseClient<Database>;
  const users: { id: string; client: SupabaseClient<Database> }[] = [];

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("The habits check only runs against loopback Supabase.");
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient<Database>(localUrl!, localServiceKey!, options);
    for (const slot of ["owner", "other"]) {
      const email = `travel-habits-${slot}-${randomUUID().slice(0, 8)}@example.test`;
      const password = `Habits-${randomUUID()}-aA1!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Could not create a local test user.");
      const client = createClient<Database>(localUrl!, localPublishableKey!, options);
      users.push({ id: created.data.user.id, client });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error("Could not sign in a local test user.");
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it("saves habits with their own revision, keeps them private and carries them in the sync profile", async () => {
    const [owner, other] = users.map((user) => ({ client: user.client, user: { id: user.id } }) as never);
    const initial = await getTravelSettings(owner);
    expect(initial.habits).toEqual({ preparationMinutes: null, arrivalBufferMinutes: null, placeModes: [], leaveFeedback: [], updatedAt: null });

    const gym = travelPlaceKey("1 Gym Street");
    const first = await saveTravelHabits(owner, { expectedUpdatedAt: null, change: { kind: "place_mode", placeKey: gym, mode: "transit" } },
      "2026-10-22T15:00:00.123456Z");
    expect(first.habits).toMatchObject({ placeModes: [{ placeKey: gym, mode: "transit", chosenAt: "2026-10-22T15:00:00.123456Z" }],
      updatedAt: "2026-10-22T15:00:00.123456Z" });
    expect(first.updatedAt).toBe(initial.updatedAt);

    const answered = await saveTravelHabits(owner, { expectedUpdatedAt: first.habits!.updatedAt, change: { kind: "leave_feedback",
      eventRef: travelEventRef("calendar", "dentist"), localDate: "2026-10-22", answer: "too_late" } }, "2026-10-22T16:00:00Z");
    expect(answered.habits?.arrivalBufferMinutes).toBe(10);
    await expect(saveTravelHabits(owner, { expectedUpdatedAt: first.habits!.updatedAt, change: { kind: "preparation", minutes: 20 } }))
      .rejects.toMatchObject({ code: "conflict" });

    // A Settings save compares the settings revision only and keeps the habits.
    const saved = await saveTravelSettings(owner, { enabled: false, baseLocationText: "10 Home Road", mode: "walking",
      navigationPreference: null, expectedUpdatedAt: initial.updatedAt, acceptRoutingDisclosure: false }, "2026-10-22T17:00:00Z");
    expect(saved.habits).toEqual(answered.habits);
    const source = await readTravelRouteSource(users[0]!.client as never, users[0]!.id);
    expect(source.habitsRevision).toBe("2026-10-22T16:00:00.000000Z");

    expect((await getTravelSettings(other)).habits?.updatedAt).toBeNull();
    const foreign = await users[1]!.client.from("travel_settings").update({ preparation_minutes: 0, habits_updated_at: "2026-10-22T18:00:00Z" })
      .eq("user_id", users[0]!.id).select("user_id");
    expect(foreign.data).toEqual([]);

    const { data, error } = await users[0]!.client.rpc("read_account_sync_snapshot");
    expect(error).toBeNull();
    const profile = (data as { entities: { kind: string; value: Record<string, unknown> }[] }).entities.find((entity) => entity.kind === "profile")!;
    expect(Object.keys(profile.value)).toHaveLength(13);
    expect(profile.value).toMatchObject({ travel_arrival_buffer_minutes: 10, travel_habits_updated_at: "2026-10-22T16:00:00.000000Z",
      travel_place_modes: [{ place_key: gym, mode: "transit", chosen_at: "2026-10-22T15:00:00.123456Z" }] });
  });
});
