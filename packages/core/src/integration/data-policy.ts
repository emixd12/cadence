/** Data classes the integration contract may and may not return. */
export const INTEGRATION_INCLUDED_DATA: readonly string[] = Object.freeze([
  "Behaviors, including archived Behaviors",
  "Schedules and time entries",
  "Categories",
  "Occurrences, stored statuses, and status history",
  "Occurrence notes and archive notes",
  "Occurrence time sessions",
  "Adherence analytics (Unresolved excluded, no streaks)",
  "Per-Behavior reminder settings",
  "The profile timezone",
]);

export const INTEGRATION_EXCLUDED_DATA: readonly string[] = Object.freeze([
  "Google Calendar events and the calendar connection",
  "Travel settings, routes, and device location",
  "Daily Brief text and preferences",
  "Reminder delivery logs and push subscriptions",
  "Import-run internals",
  "Credentials and tokens",
  "The email address and display name",
  "The internal account user id (only a per-client pairwise id is returned)",
]);

/**
 * Output property names that would indicate an excluded data class. Tests
 * walk every output schema and fail if any property name contains one of
 * these fragments.
 */
export const INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS: readonly string[] = Object.freeze([
  "email_address",
  "user_email",
  "display_name",
  "user_id",
  "calendar",
  "travel",
  "route",
  "latitude",
  "longitude",
  "coordinates",
  "brief",
  "delivery",
  "deliveries",
  "push_subscription",
  "endpoint",
  "import_run",
  "token",
  "secret",
  "password",
  "streak",
  "missed",
]);
