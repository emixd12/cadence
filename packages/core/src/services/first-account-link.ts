import { DEFAULT_CATEGORY_NAMES } from "../types/database";
import type { PortabilitySnapshot } from "../types/portability-rows";
import type { AccountSyncSnapshot } from "../resolvers/account-sync.resolver";
import type { Json } from "../types/json";
import { normalizeCategoryName } from "./category.service";
import { toBehaviorConfigurationSnapshotPayload } from "./configuration-payload";
import { normalizeBehaviorConfiguration } from "../resolvers/behavior-configuration.resolver";
import type { BehaviorConfigurationSnapshot } from "../types/behavior-configuration-event";

const DEFAULT_TIMEZONE = "America/New_York";

// Private account fields cannot travel through the location-free BehaviorLog export,
// which also omits Behavior Where (Ticket 215) and completion place labels (Ticket 216).
export function firstLinkIncludesTravel(snapshot: AccountSyncSnapshot): boolean {
  return snapshot.entities.some(({ kind, value }) => {
    if (kind === "place_label_settings" || kind === "place_marker" || kind === "completion_place_label" || kind === "where_suggestion_dismissal") return true;
    const row = object(value);
    // Learned travel habits (Ticket 217) have a revision once anything was learned.
    if (kind === "profile") return !!(row.travel_enabled || row.base_location_text || row.travel_mode ||
      row.navigation_preference || row.routing_consent_at || row.onboarding_completed_at || row.travel_habits_updated_at);
    if (kind === "behavior") return !!(row.location_text || row.where_kind);
    return kind === "configuration_event" && [row.previous_configuration, row.next_configuration]
      .some((configuration) => configuration && (object(configuration).location_text || object(configuration).locationText
        || object(configuration).where_kind || object(configuration).whereKind));
  });
}

export function preparePrivateFirstLinkImport(local: AccountSyncSnapshot, hosted: AccountSyncSnapshot) {
  const hostedCategories = new Map(hosted.entities.filter(({ kind }) => kind === "category")
    .map((entity) => [normalizeCategoryName(String(object(entity.value).name)), entity]));
  const aliases = new Map(local.entities.filter(({ kind }) => kind === "category").flatMap((entity) => {
    const match = hostedCategories.get(normalizeCategoryName(String(object(entity.value).name)));
    return match && match.id !== entity.id ? [[entity.id, match] as const] : [];
  }));
  const categoryId = (value: Json | undefined) => typeof value === "string" ? aliases.get(value)?.id ?? value : value;
  const configuration = (value: Json | undefined): Json => {
    if (value == null) return null;
    const source = object(value);
    const row = "scheduleGraph" in source
      ? object(toBehaviorConfigurationSnapshotPayload(normalizeBehaviorConfiguration(source as unknown as BehaviorConfigurationSnapshot))) : source;
    return { ...row, category_id: categoryId(row.category_id) };
  };
  return {
    baseline: { entities: [{ kind: "profile" as const, id: "profile", value: { timezone: DEFAULT_TIMEZONE } }] },
    local: { entities: local.entities.map((entity) => {
      const row = object(entity.value);
      const alias = entity.kind === "category" ? aliases.get(entity.id) : undefined;
      if (alias) return { ...entity, id: alias.id, value: { ...row, id: alias.id, created_at: object(alias.value).created_at } };
      if (entity.kind === "behavior") return { ...entity, value: { ...row, category_id: categoryId(row.category_id) } };
      if (entity.kind === "configuration_event") return { ...entity, value: { ...row,
        previous_configuration: configuration(row.previous_configuration), next_configuration: configuration(row.next_configuration) } };
      return entity;
    }) },
  };
}

function object(value: Json): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Invalid first-link account row.");
  return value;
}

export function hasRecognizedLocalData(snapshot: PortabilitySnapshot & { reminderDeliveries?: readonly unknown[]; noteShortcutStates?: readonly unknown[] }): boolean {
  if (snapshot.profile.timezone !== DEFAULT_TIMEZONE) return true;
  const travel = snapshot.travelSettings;
  if (travel && (travel.enabled || travel.baseLocationText || travel.mode || travel.navigationPreference ||
    travel.routingConsentAt || travel.onboardingCompletedAt || travel.habits?.updatedAt)) return true;
  const categories = [...snapshot.categories]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map(({ name }) => name);
  if (categories.length !== DEFAULT_CATEGORY_NAMES.length ||
      categories.some((name, index) => name !== DEFAULT_CATEGORY_NAMES[index])) return true;
  return snapshot.graphs.length > 0 || snapshot.definitionEvents.length > 0 ||
    snapshot.configurationEvents.length > 0 || snapshot.occurrences.length > 0 ||
    snapshot.statusEvents.length > 0 || snapshot.timeSessions.length > 0 ||
    snapshot.importRuns.length > 0 || snapshot.mappings.length > 0 ||
    snapshot.importedNotes.length > 0 || snapshot.importedInterventions.length > 0 ||
    (snapshot.reminderDeliveries?.length ?? 0) > 0 ||
    (snapshot.noteShortcutStates?.length ?? 0) > 0 ||
    (snapshot.placeLabelSettings?.length ?? 0) > 0;
}
