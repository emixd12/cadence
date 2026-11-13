export type CalendarPurpose = "standard" | "agent";
export type CalendarPreferences = Readonly<{ selectedCalendarIds: string[]; hiddenCalendarIds: string[]; visible: boolean; showAllDay: boolean }>;
export type CalendarConnection = Readonly<{ grantPurpose?: CalendarPurpose; oauthClientId?: string; userId: string; googleSubject: string; generation: number; selectionRevision: number;
  status: "connected" | "disconnected" | "reconnect_required"; preferences: CalendarPreferences }>;
export type CalendarConnectionView = Readonly<{ accountId: string; status: CalendarConnection["status"] | "not_configured" | "unavailable";
  generation: number; selectionRevision: number; preferences: CalendarPreferences;
  /**
   * Ticket 335 (D31.5): present only when the account does not have exactly one Google
   * sign-in. `add`: Connect first adds Google as a sign-in method (web, linking on).
   * `add_on_web`: the same, but only from Cadence on the web. `unavailable`: linking is
   * off. `multiple`: more than one Google sign-in, so Calendar cannot choose.
   */
  googleSignIn?: CalendarGoogleSignIn }>;
export type CalendarGoogleSignIn = "add" | "add_on_web" | "unavailable" | "multiple";
/** Ticket 335: Settings `calendar` value on the return from adding Google before Calendar consent. */
export const CALENDAR_AFTER_GOOGLE_SIGN_IN = "link";
export const GOOGLE_CALENDAR_SETTINGS_PATH = "/settings#connector-google_calendar";
export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = { selectedCalendarIds: [], hiddenCalendarIds: [], visible: true, showAllDay: true };
export type CalendarOAuthAttempt = Readonly<{ grantPurpose?: CalendarPurpose; oauthClientId?: string; userId: string; googleSubject: string; generation: number; stateHash: string;
  sealedVerifier: string; target: "web" | "desktop"; clientState: string; expiresAt: string }>;
export type CalendarListEntry = Readonly<{ id: string; name: string; timezone: string; primary: boolean; selected: boolean; accessRole: "reader" | "writer" | "owner" }>;
