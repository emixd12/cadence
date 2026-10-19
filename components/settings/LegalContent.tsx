import type { ReactNode } from "react";
import { MARKETING_SITE_URL } from "../../lib/marketing-site";

import {
  exportFormats,
  statusDefinitions,
} from "../../apps/marketing/src/data/vocabulary";

export type LegalPageKey = "privacy" | "terms" | "trust";

type LegalSection = Readonly<{
  title: string;
  paragraphs: readonly string[];
  items?: readonly string[];
  links?: readonly Readonly<{ label: string; href: string }>[];
  table?: Readonly<{
    caption: string;
    headers: readonly string[];
    rows: readonly (readonly string[])[];
  }>;
}>;

type LegalPage = Readonly<{
  title: string;
  summary: string;
  updated: string;
  sections: readonly LegalSection[];
}>;

export const LEGAL_PAGE_ORDER: readonly LegalPageKey[] = [
  "privacy",
  "terms",
  "trust",
];

export const LEGAL_PAGES: Readonly<Record<LegalPageKey, LegalPage>> = {
  privacy: {
    title: "Privacy",
    summary:
      "Privacy policy for the Cadence marketing site and hosted personal behavior tracker.",
    updated: "October 18, 2026",
    sections: [
      {
        title: "Scope and operator",
        paragraphs: [
          "This policy describes the Cadence marketing site and hosted personal behavior tracker operated by Identity Scaffolding LLC, a Wyoming limited liability company assumed authorized in New York, at 30 N Gould St Ste R, Sheridan, WY 82801.",
          "The public marketing site presents product information. It does not use marketing analytics, advertising pixels, payment tracking, or social tracking. Hosting infrastructure may still process ordinary request data such as an IP address, browser details, requested path, and request time.",
        ],
      },
      {
        title: "Account and behavior data",
        paragraphs: [
          "Google sign-in can provide an account identifier, email address, and profile information. Cadence stores the profile timezone and the records needed to operate the account.",
          "Those records can include categories, Behaviors, Schedules, reminders, Occurrences, Decisions, notes, optional timing data, definition and Decision history, imports, export activity, push subscriptions, and reminder delivery records.",
          "Notes are free text. Users should not enter information they do not want stored in Cadence.",
        ],
      },
      {
        title: "Optional Google Calendar",
        paragraphs: [
          "The Google Calendar connector is optional. Where enabled, it requires separate read-only consent for the same Google account used to sign in. Cadence reads your subscribed calendar list so you can choose calendars, then reads events from selected calendars intersecting displayed days, including readable titles, descriptions, times, locations, organizers, attendees, conference details, attachment links, and Google event links. It does not create, edit, or delete Google events or download attachments automatically.",
          "Cadence uses Calendar information to show selected events in Timeline and provide advisory overlap context. It does not sell Calendar information or use it for advertising. Sending selected Calendar timing to OpenAI for Daily Brief requires a separate choice, described below. Calendar information is never shared through MCP.",
          "Vercel runtime processes Calendar API requests and returned event details while serving a refresh. Supabase stores the account's connector status, calendar selections, display preferences, and encrypted Google refresh credential. Cadence does not store Google event details in its hosted database. The web app holds returned event details in memory. Desktop can store the last complete normalized event snapshot in a separate account-bound cache for offline display; its account session and pending consent state use macOS Keychain.",
          "Calendar details and credentials are excluded from Cadence exports, account synchronization, and user-created desktop tracking backups. Deleted connector records and sealed credential ciphertext may remain in Supabase backup copies until Supabase removes those copies under its backup lifecycle. Live-record deletion does not immediately erase existing backups.",
          "Disconnect Google Calendar marks the account connection disconnected, clears selected calendar IDs, deletes the live server credential, and requests Google grant revocation. If Google cannot confirm revocation, the user must remove Cadence in Google Account permissions. Other clients stop refreshing after they next receive the connection change; an offline desktop device may retain stale cached event details until it reconnects or its Cadence account is disconnected.",
          "Ordinary web sign-out ends that browser's Cadence session but leaves the account-level Calendar connection active. Desktop Cadence account disconnect or reconnect clears that Mac's Calendar cache and pending consent state but does not revoke the global Google grant. Account deletion attempts revocation and removes the live Auth user and owner-scoped connector records. If revocation fails, Google Account permissions may still show the grant.",
          "Cadence's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including its Limited Use requirements.",
        ],
        links: [
          {
            label: "Read the Google API Services User Data Policy",
            href: "https://developers.google.com/terms/api-services-user-data-policy",
          },
        ],
      },
      {
        title: "Outlook Calendar, iCloud Calendar, and Hevy",
        paragraphs: [
          "These connectors have local source and synthetic verification on web and linked desktop. Live Microsoft, Apple, and Hevy access, installed desktop behavior, and deployment remain unverified. Local checks do not establish public availability.",
          "Where enabled, Outlook Calendar uses separate Microsoft consent with Calendars.ReadBasic. iCloud Calendar uses an Apple Account email and app-specific password for hosted CalDAV reads. Cadence reads selected calendars and normalizes event titles, times, timezone and availability. It discards unsupported details. Neither connector edits events. iCloud calendars stored only on a Mac are excluded.",
          "Apple does not limit this app-specific password to Calendar; it can also reach Mail, Contacts and other iCloud data. Cadence restricts its use to Calendar reads. Never enter a primary Apple Account password. Cadence seals the email and app-specific password on the server.",
          "Hevy requires Hevy Pro and an API key. The key has no documented read-only scope; Cadence permits only its allowlisted reads. Provider responses can contain workout titles, exercises, sets, weights, routines and notes. Cadence discards these details and exposes only recorded workout timing and duration. Location is unsupported. Workouts never automatically complete or change a Behavior or Occurrence.",
          "Hevy reads scan the account's workout history, even for a request covering today. Accounts above 500 workouts return incomplete coverage without reading workout pages. Within that global bound, count and page checks detect some changes during a read. A complete result means no change was detected; it is not an atomic snapshot and concurrent changes can still escape detection.",
        ],
      },
      {
        title: "Connector custody and removal",
        paragraphs: [
          "Supabase stores account-bound connection metadata, selections and display preferences. Sealed credentials stay in a private schema. Vercel processes provider requests and responses. Provider credentials never enter client responses, tracking exports, account synchronization or user-created desktop backups. Key and password entry is transient; clients send it once to the hosted service and do not persist it.",
          "Cadence does not persist these source events or workouts in its hosted database. Web snapshots stay in memory. Linked desktop can retain the last complete normalized snapshot in a separate disposable account-bound cache for offline display. This cache is outside the tracking database, exports, synchronization and user-created backups. A failed or incomplete refresh may keep that snapshot with a stale warning; it does not prove availability or workout absence.",
          "Disconnect deletes Cadence's live credential and clears that source's cache on the client handling it. Other devices learn of removal on their next connection check; an offline device may retain stale data until it reconnects or its Cadence account is disconnected. Desktop sign-out and account switching clear local source caches. Web sign-out leaves account-level connections active. Successful account deletion removes live connection records and sealed credentials; infrastructure backup remnants follow the retention table below.",
          "Cadence does not revoke Outlook, iCloud or Hevy access at the provider. Remove Cadence in Microsoft account app permissions or work/school My Apps, revoke the app-specific password at account.apple.com, or remove or regenerate the API key in Hevy settings. Do this after disconnect or account deletion if you want the provider credential or grant revoked.",
        ],
      },
      {
        title: "Exports and connected AI clients",
        paragraphs: [
          `Cadence provides ${exportFormats.join(", ")} exports and prepared prompts. The user chooses when and where to download or share an export or prompt.`,
          "You can also connect an AI client, such as Claude or ChatGPT, to your hosted Cadence account. When you authorize the connection and direct the client to use Cadence, Cadence sends requested tracking records to that client and its provider. The client's terms, privacy policy, retention settings, and data-use controls govern its processing of information it receives.",
          "Read permission covers active and archived Behaviors, descriptions, user-authored Behavior locations, schedules, time entries, categories, Occurrences, statuses, status history, Occurrence notes, archive notes, time sessions, adherence summaries, reminder settings, and your profile timezone. Responses also include record identifiers, revision and freshness information, and a client-specific account reference. Behaviors and notes can reveal personal health information or other sensitive information you enter. Read access is not limited to records you mention in one conversation. Connect only clients you trust with these records.",
          "Google Calendar data and its connection are never shared through MCP. MCP also excludes travel settings, route estimates, device location, Daily Brief content and preferences, reminder delivery logs, push subscriptions, import-run internals, account email addresses, and credentials. A user can still type sensitive information into a Behavior or note; Cadence does not automatically remove that information from tracking records.",
          "Read access is required for a connection. You may separately allow the client to mark Occurrences and edit their notes, or create, edit, archive, and restore Behaviors. MCP provides no delete operation. You direct and confirm changes in the AI client. Cadence checks the permissions granted to the connection; the AI client controls its per-action confirmation experience.",
          "Cadence records integration activity to show access and changes and investigate problems. This record contains the client, operation, record identifiers, time, outcome, and error code. It does not contain note text, full request or response content, or authentication secrets. The activity retention policy is 90 days. Older entries disappear from the activity view and become eligible for deletion by maintenance, or when further activity triggers cleanup for that account.",
          "Cadence separately stores write results for retry protection for a 24-hour validity period. Those results may contain the tracking content returned by the operation. Maintenance deletes expired retry records. Expiry prevents reuse; it does not mean immediate physical deletion. Healthy daily maintenance removes eligible records within roughly one additional day. Failed maintenance can extend storage. Backup retention is separate.",
          "Disconnect a client in Settings > Connected apps to revoke that connection. Cadence rejects its next access or refresh request. Disconnecting does not delete tracking records, erase completed changes, or retrieve copies already received by the client. Contact the client's provider to manage those copies. Deleting your Cadence account removes its live account-owned integration records. Backup remnants follow the retention periods in this policy.",
          "Cadence also keeps shared client registration metadata, such as client names, redirect addresses, and registration details. Used dynamic client registrations and cached client metadata have no automatic deletion deadline. A metadata refresh interval is not a deletion deadline. Disconnecting or deleting an account does not remove a shared client registration.",
          "Cadence does not sell your personal data. Cadence shares tracking records through MCP to carry out the access you authorize and the requests you direct. Account-free desktop records stay on the device and are unavailable through MCP. Linked desktop records become available after synchronization.",
        ],
      },
      {
        title: "Optional Daily Brief",
        paragraphs: [
          "Daily Brief is separate from connected AI clients. When you enable Daily Brief, Cadence can prepare a read-only briefing when you first open Timeline each day. Cadence sends today's Behavior schedule and completion history, including findings calculated from it, to OpenAI. The briefing cannot change tracking or Calendar records.",
          "Google Calendar, Outlook Calendar, iCloud Calendar and Hevy each need a separate Daily Brief choice. Connecting a source or displaying it on Timeline does not grant model access. Calendar context uses today's selected event timing, timezone, availability and response state without event titles or details. Hevy contributes only today's recorded workout timing and duration, never exercise details or evidence of free time. Credentials and raw provider records never enter the model input.",
          "Where the optional controls are available, reminder delivery history and Notes on Not Completed occurrences also require separate choices. Reminder analysis sends only counts calculated from reminder send records, never reminder content. When a Notes pattern is selected as the tip, Cadence sends up to 12 Notes, the first 280 characters of each, from Not Completed occurrences in the last 90 days. Other Notes are not sent through that option.",
          "Reconnecting a new source or changing its calendar selection requires allowing it again. Disconnect, disclosure withdrawal and account changes fence pending results. Turning Daily Brief off revokes its optional source choices. Older clients saving Daily Brief preferences also turn the new source choices off.",
          "Daily Brief settings are stored with your account. Cadence keeps operational metadata to control generation attempts and avoid repeated tips. It does not save prompts or generated briefing text in its hosted database. Generated text stays in page-session memory. Device markers record attempt and display state, not generated text.",
          "Cadence retains no production prompt or briefing history. Generated text stays in memory until it expires or is cleared. Private operational records retain preferences, recent attempt metadata and admission timestamps; account deletion removes them. Cadence requests store:false from OpenAI, which does not promise zero provider retention. Provider abuse-monitoring and prompt-cache retention can still apply. Turning a source off stops future sharing; it cannot recall input already sent.",
          "Turning Daily Brief off stops future generation and clears optional Daily Brief disclosure choices. It removes live generation-run and tip-repetition metadata. Account deletion removes live account-owned Daily Brief records. Copies already processed by OpenAI are subject to OpenAI's data controls and retention; Cadence does not promise zero provider retention or recall information already sent.",
          "On desktop, Daily Brief is available only to linked, online accounts. Its hosted context excludes local-only and unsynchronized desktop records. Daily Brief consent does not authorize MCP access, and MCP consent does not authorize Daily Brief.",
        ],
        links: [
          {
            label: "Read OpenAI's API data controls",
            href: "https://developers.openai.com/api/docs/guides/your-data",
          },
        ],
      },
      {
        title: "Travel routing",
        paragraphs: [
          "Travel routing is optional and off by default. Turning it on requires separate routing consent in Travel settings. When it is on, Cadence estimates travel to and from Behaviors that have a location and selected Google Calendar events that have a location. It uses the selected transport mode, an optional saved base for the final return, and the device's current location when the user has granted location permission.",
          "Cadence reads the device location only while Cadence is open in the foreground: during an explicit permission check, during a travel refresh, and once when the Timeline opens with a current estimate, to check whether the user has moved. Only the permission check and turning travel on can show the system location prompt. Cadence does not track location in the background and does not save device locations.",
          "To estimate travel, Cadence sends Google Maps Platform the location text it has not looked up before, including the location text of selected Calendar events, the device location when used, place identifiers, the selected mode, and route times. Cadence does not send Calendar titles, notes, emails, account IDs, Calendar credentials, or raw Calendar payloads. These requests come from Cadence's servers, not the user's device. Google may use and retain request data, such as coordinates, to provide and improve its services under the Google Privacy Policy. Opening a Directions or Search in maps link takes the user directly to Google Maps or Apple Maps under that provider's terms.",
          "Cadence keeps user-authored locations, such as Behavior locations and the saved base, until the user edits or removes them. Behavior configuration history and existing backups can retain earlier locations. To avoid repeat lookups, Cadence stores Google's place identifier for each looked-up location with the account, keyed by a one-way fingerprint of the typed text. It does not store that text, coordinates, or route results there.",
          "Device locations and route estimates stay in temporary memory and are excluded from Cadence sync, exports, backups, analytics, and logs. Operational logs may record the number and duration of travel requests, never locations. Cadence records the monthly total of travel provider usage reserved for the account to enforce its monthly limit.",
          "Turning travel off stops new requests, clears temporary travel estimates, and deletes the stored place identifiers. Removing device location permission stops location reads. Account deletion removes all travel records.",
        ],
        links: [
          {
            label: "Read the Google Privacy Policy",
            href: "https://policies.google.com/privacy",
          },
        ],
      },
      {
        title: "How Cadence uses data",
        paragraphs: [
          "Cadence uses data to authenticate accounts, generate scheduled Occurrences, display records, save explicit Decisions and notes, provide optional timing, send configured reminders, calculate basic analytics, create exports, secure the service, prevent abuse, diagnose failures, and respond to requests. Cadence also carries out the connected-client access you authorize and prepares Daily Brief when you enable it.",
          "Cadence does not sell personal information or share it for cross-context behavioral advertising. Cadence does not automatically turn an Unresolved Occurrence into a failure.",
        ],
      },
      {
        title: "Processors",
        paragraphs: [
          "Cadence uses the following service providers for the stated purposes. A provider processes data under its own service terms and the operator's configuration.",
          "A connected external AI client's provider receives the tracking data described under Exports and connected AI clients. That provider's terms and privacy policy govern its processing. This is separate from Cadence's use of OpenAI for Daily Brief.",
        ],
        table: {
          caption: "Cadence service providers and purposes",
          headers: ["Provider", "Purpose", "Data involved"],
          rows: [
            [
              "Vercel",
              "Application and marketing hosting, connector refreshes and Daily Brief requests",
              "Request and runtime data, returned provider records during a refresh, and disclosed briefing inputs",
            ],
            [
              "Supabase",
              "Google authentication and database storage",
              "Account and Cadence records, connector metadata, selections, disclosure preferences and sealed credential ciphertext",
            ],
            [
              "Google",
              "User-selected Google sign-in and optional Google Calendar consent and API access",
              "Google account, authentication, selected-calendar, and readable event data",
            ],
            [
              "Microsoft Graph, Apple iCloud, and Hevy",
              "Optional source access where enabled; live acceptance remains unverified",
              "Provider authentication and selected-calendar or workout responses; Hevy details are discarded after receipt",
            ],
            [
              "OpenAI",
              "Optional Daily Brief generation where enabled",
              "Disclosed Behavior context and separately allowed source timing; provider retention may apply",
            ],
            [
              "Google Maps Platform",
              "Optional travel routing and place lookups",
              "Location text not looked up before, place identifiers, device location when used, transport mode, and route times",
            ],
            [
              "Browser push services",
              "Optional browser reminders",
              "Push endpoint and reminder delivery data",
            ],
            [
              "Sequenzy",
              "Optional email reminders",
              "Email address and reminder message data",
            ],
            [
              "Microsoft 365",
              "Privacy, support, and dispute correspondence",
              "Contact details and message content",
            ],
            [
              "OpenAI",
              "Optional in-app Daily Brief generation",
              "Behavior schedule, completion history and calculated findings; separately enabled Calendar timing, reminder counts, and selected note excerpts",
            ],
          ],
        },
      },
      {
        title: "Retention",
        paragraphs: [
          "Cadence uses the retention periods below. A provider may delete data sooner. Specific records may be kept longer when required for a security investigation, fraud prevention, or legal preservation.",
          "The existing infrastructure retention periods do not establish live verification or release approval for the new connectors.",
          "Supabase maintains database backups. Deleted records may remain in backup copies until Supabase removes those copies under its backup lifecycle. Live-record deletion does not immediately erase existing backups.",
        ],
        table: {
          caption: "Cadence retention periods as of October 18, 2026",
          headers: ["Record", "Retention period", "Active control"],
          rows: [
            [
              "Routine logs",
              "No more than 7 days",
              "Vercel Pro runtime logs: 1 day; Supabase Pro API and database logs: 7 days",
            ],
            [
              "Security-incident logs",
              "Up to 90 days or the end of the investigation",
              "Records are preserved only when needed for an active investigation",
            ],
            [
              "Backups",
              "Until Supabase removes the copies under its backup lifecycle",
              "Live-record deletion does not immediately erase existing backups.",
            ],
            [
              "Deleted-account live data",
              "Immediately or within 7 days",
              "Auth deletion and database cascades remove live account data immediately when deletion succeeds",
            ],
            [
              "Deleted-account backup remnants",
              "Until Supabase removes the copies under its backup lifecycle",
              "Live-record deletion does not immediately erase existing backups.",
            ],
            [
              "Google Calendar connector records",
              "Live credential until Calendar disconnect, access revocation, or account deletion; connector status and preferences until account deletion",
              "Disconnect deletes the live credential; backup copies remain until Supabase removes them under its backup lifecycle",
            ],
            [
              "Desktop Google Calendar cache",
              "Until replacement, Calendar disconnect, Cadence account disconnect or reconnect, or local app-data removal",
              "Separate local cache; excluded from Cadence exports, account synchronization, and user-created desktop backups",
            ],
            [
              "Outlook, iCloud, and Hevy connector records",
              "Live credential until disconnect or account deletion; connection metadata and disclosure preferences until account deletion",
              "Disconnect fences reads and deletes the live credential; it does not revoke provider access. Infrastructure backup remnants may remain up to 7 days",
            ],
            [
              "Desktop Outlook, iCloud, and Hevy caches",
              "Until replacement, observed source removal, desktop sign-out, account switch or local app-data removal",
              "Disposable source caches outside tracking exports, synchronization and user-created backups; offline devices can retain stale context",
            ],
            [
              "Daily Brief",
              "Generated text in memory only; preferences until account deletion; bounded attempt metadata clears on disablement",
              "No production prompt or briefing history in Cadence; OpenAI retention is separate from Cadence storage",
            ],
            [
              "Travel place identifiers",
              "While travel stays on; a lookup older than 365 days is repeated when next needed",
              "Turning travel off or deleting the account deletes them; backup copies remain until Supabase removes them under its backup lifecycle",
            ],
            [
              "Travel usage totals",
              "Monthly totals until account deletion",
              "Used only to enforce the monthly travel limit; contain amounts and dates, never locations",
            ],
            [
              "Device locations and route estimates",
              "Memory for the current app session",
              "Not saved to Cadence's database, synchronization, exports, or backups",
            ],
            [
              "Browser-push payloads",
              "No more than 24 hours after send",
              "Cadence sends a 24-hour TTL; the push service may retain the payload for less",
            ],
            [
              "Sequenzy transactional data",
              "Under Sequenzy's active service terms and controls",
              "Subscriber data remains while the account is active and is deleted within 30 days after account termination",
            ],
            [
              "Support messages",
              "12 months after resolution",
              "Microsoft 365 mailbox retention is configured for this period",
            ],
            [
              "Integration activity",
              "90-day policy; older entries are hidden and eligible for cleanup",
              "Daily maintenance and account activity can delete older entries. Healthy daily maintenance adds roughly one day; failures can delay deletion.",
            ],
            [
              "Integration retry results",
              "24-hour validity; physical deletion follows maintenance",
              "Expired results cannot be reused. Results can contain returned tracking content. Daily maintenance removes expired rows; failures can delay deletion.",
            ],
            [
              "Connection grants and account-owned integration references",
              "Until account deletion; disconnect revokes access without deleting every record",
              "Account deletion removes live account-owned records. Shared client registration metadata remains separate.",
            ],
            [
              "Authorization requests, code hashes, and token hashes",
              "No access after expiry or revocation; physical deletion follows the applicable cleanup rule",
              "Maintenance deletes expired authorization requests, code hashes and access-token hashes. Refresh families and their tokens are deleted after the family's absolute expiry, which is at most 90 days. Disconnect does not promise immediate physical deletion.",
            ],
            [
              "Shared client registration metadata",
              "Unused dynamic registrations expire after 24 hours; used dynamic registrations and cached client metadata have no automatic deletion deadline",
              "Maintenance removes eligible expired unused registrations without grants. Shared registrations remain after an account disconnects or is deleted. Refreshing cached client metadata is not deletion.",
            ],
            [
              "Daily Brief preferences and operational metadata",
              "Preferences until account deletion; run and tip metadata until replacement, applicable cleanup, disablement, or account deletion",
              "Preference changes clear run metadata. Turning Daily Brief off also clears tip-repetition metadata. These records do not contain prompts or generated briefing text. Provider retention is separate.",
            ],
          ],
        },
      },
      {
        title: "Security",
        paragraphs: [
          "Cadence uses Google sign-in through Supabase Auth, account-scoped database Row Level Security, server-side privileged operations, secret scanning, and export and account-deletion controls.",
          "No internet service is completely secure. Users should protect their Google account, sign out on shared devices, and avoid placing sensitive information in free-text notes.",
        ],
      },
      {
        title: "User choices and deletion",
        paragraphs: [
          `Users can export records as ${exportFormats.join(", ")}, manage reminder choices, edit their records, and delete their account in Settings. Export needed records before deletion because account deletion is permanent.`,
          "A user can deny browser notification permission or leave optional email reminders disabled. Required account and service processing cannot be disabled while using the hosted tracker.",
          "Users can manage connected-client access in Settings > Connected apps and control Daily Brief separately in Settings. Turning off Daily Brief does not revoke an MCP connection, and disconnecting an MCP client does not turn off Daily Brief.",
        ],
      },
      {
        title: "Children and international access",
        paragraphs: [
          "Cadence is only for people age 18 or older. Cadence is not directed to children and does not knowingly permit anyone under 18 to register.",
          "Cadence operates from the United States. A person who accesses Cadence from another country understands that data may be processed in the United States and other places where the listed providers operate, subject to applicable law.",
        ],
      },
      {
        title: "California disclosures",
        paragraphs: [
          "Cadence does not sell personal information or share it for cross-context behavioral advertising. Cadence has no actual knowledge that it sells or shares personal information of people under 16.",
          "Subject to applicable law, California residents may request access, correction, deletion, or a copy of personal information and may exercise privacy rights without discriminatory treatment. Cadence may verify a request before acting.",
        ],
      },
      {
        title: "Changes and contact",
        paragraphs: [
          "Identity Scaffolding LLC may update this policy when Cadence, its providers, or legal requirements change. A material update will receive a new date and any notice required by law.",
          "Privacy questions and requests may be sent to privacy@identityscaffolding.com or mailed to Identity Scaffolding LLC, 30 N Gould St Ste R, Sheridan, WY 82801.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms",
    summary:
      "Terms for the hosted Cadence personal behavior tracker.",
    updated: "October 18, 2026",
    sections: [
      {
        title: "Acceptance and operator",
        paragraphs: [
          "These Terms govern access to the hosted Cadence service operated by Identity Scaffolding LLC, a Wyoming limited liability company assumed authorized in New York, at 30 N Gould St Ste R, Sheridan, WY 82801.",
          "By creating an account or using the hosted service, the user agrees to these Terms and the Privacy Policy. A person who does not agree must not use the hosted service.",
        ],
      },
      {
        title: "Product model and user declarations",
        paragraphs: [
          "Cadence is a general-purpose personal behavior record for one independent account at a time. It records recurring Behaviors, scheduled Occurrences, explicit Decisions, optional Context, reminders, analytics, and exports.",
          `${statusDefinitions.completed} ${statusDefinitions.notCompleted} ${statusDefinitions.unresolved}`,
          "Needs decision is a UI group for prior unresolved occurrences. It is not a stored status and should not be treated as an automatic failure.",
          "The user supplies and controls their declarations. Cadence does not verify that a declaration is accurate and does not infer completion, failure, diagnosis, or treatment.",
        ],
      },
      {
        title: "Eligibility and accounts",
        paragraphs: [
          "A user must be at least 18 and legally able to accept these Terms. Each user must provide accurate account information and use only an account they are authorized to use.",
          "Sign-in uses Google through Supabase Auth. The user is responsible for securing the Google account and device, signing out on shared devices, and promptly reporting suspected unauthorized access.",
        ],
      },
      {
        title: "General-purpose recordkeeping",
        paragraphs: [
          "Cadence is not an emergency system, medical device, clinical decision tool, medication dosing system, supply or refill tracker, professional advice service, or guaranteed reminder service.",
          "The user decides whether Cadence is suitable for a personal workflow. The user must not rely on Cadence to prevent injury, diagnose or treat a condition, meet a legal deadline, or perform another safety-critical task.",
        ],
      },
      {
        title: "Exports and connected AI clients",
        paragraphs: [
          `Cadence provides ${exportFormats.join(", ")} exports and prepared prompts. The user is responsible for safeguarding downloaded files and deciding whether to share them.`,
          "You may authorize an external AI client to access your hosted Cadence account through MCP. You choose the client and grant its permissions. You direct the requests and review changes before confirming them in that client. Read permission permits access to tracking records, including notes and history; write permissions separately allow Occurrence changes or Behavior changes. There is no MCP delete operation. Calendar data is never shared through MCP.",
          "A client may misunderstand a request or produce incorrect information. Check the Behavior, Occurrence, date, and proposed values before confirming a change. You remain responsible for the declarations and instructions you provide. Cadence does not verify that a Behavior occurred and does not turn an Unresolved Occurrence into an automatic failure.",
          "External AI clients operate under their own terms and privacy policies. Cadence's Privacy Policy describes the data disclosed through MCP, integration activity retention, and your controls. Cadence does not sell your personal data. Disconnect in Settings > Connected apps to stop further access by that connection. Disconnecting does not reverse earlier changes or delete copies that another service already received.",
          "Cadence remains a personal recordkeeping service. Neither this connection nor an AI response makes it medical advice, a dosing system, an emergency service, or a substitute for a qualified professional. Do not use it for safety-critical decisions or share records you are not entitled to disclose.",
        ],
      },
      {
        title: "Optional Daily Brief",
        paragraphs: [
          "Daily Brief is an optional, read-only feature separate from connected AI clients. When enabled, it uses OpenAI to prepare a briefing from the data described in the Privacy Policy. Separate choices control optional Calendar timing, reminder delivery counts, and selected Notes. Each connected source requires its own model-data choice.",
          "A briefing can be incomplete or incorrect. It cannot change tracking or Calendar records. Check its suggestions against your records and circumstances. Daily Brief is subject to the General-purpose recordkeeping limits above and must not be used for safety-critical decisions.",
        ],
      },
      {
        title: "Travel routing limits",
        paragraphs: [
          "Travel routing is optional and requires separate consent. Route estimates are planning information only. They can be unavailable, late, incomplete, or wrong and do not promise a route, arrival time, transit connection, parking, accessibility, or safety.",
          "A user must not rely on Cadence travel estimates for emergency response, safety-critical travel, medical care, legal deadlines, or navigation. The user remains responsible for choosing a route and checking current conditions.",
          "Cadence limits travel estimates for each account every month. When an account reaches the limit, Cadence stops new estimates until the date it shows. Earlier estimates may stay visible and may be out of date. Cadence may change the limit.",
          "Cadence travel features include Google Maps features and content. Use of Google Maps features and content is subject to the then-current Google Maps/Google Earth Additional Terms of Service and the Google Privacy Policy.",
        ],
        links: [
          {
            label: "Read the Google Maps/Google Earth Additional Terms of Service",
            href: "https://maps.google.com/help/terms_maps/",
          },
          {
            label: "Read the Google Privacy Policy",
            href: "https://policies.google.com/privacy",
          },
        ],
      },
      {
        title: "Acceptable use",
        paragraphs: [
          "A user must not break the law; harm another person; access another account; probe, disrupt, overload, or bypass service protections; upload malicious code; scrape the service at unreasonable volume; impersonate another person; or use Cadence to administer records for someone without authority.",
          "A user retains responsibility for account content and must have the rights needed to submit it. Each account remains single-player; Cadence does not provide shared workspaces, social tracking, or public profiles.",
        ],
      },
      {
        title: "Source license and other rights",
        paragraphs: [
          "Owner-controlled source code, repository documentation, and synthetic sample content are available under the MIT license in the public repository at github.com/emixd12/cadence. The repository license governs only material within its stated scope.",
          "The hosted service, production credentials, Cadence names and logos, site content outside the repository license, tracked binary assets excluded by the repository license notice, and user-owned data are governed separately. The MIT license grants no trademark right or right to access the hosted service.",
        ],
      },
      {
        title: "Availability, changes, and suspension",
        paragraphs: [
          "Cadence is currently available without charge. Identity Scaffolding LLC does not promise permanent free service, uninterrupted availability, error-free operation, reminder delivery, or preservation of every record.",
          "Identity Scaffolding LLC may change, limit, suspend, or discontinue the hosted service and may suspend or terminate access for a Terms violation, security risk, legal requirement, abuse, or threat to the service or others. When practical, users should export records they wish to keep.",
        ],
      },
      {
        title: "Disclaimers",
        paragraphs: [
          "To the fullest extent permitted by law, the hosted service is provided “as is” and “as available.” Identity Scaffolding LLC disclaims warranties of merchantability, fitness for a particular purpose, title, noninfringement, accuracy, availability, and that reminders or records will meet a user's requirements.",
          "Nothing in these Terms excludes a warranty or right that applicable law does not allow the parties to exclude.",
        ],
      },
      {
        title: "Limitation of liability",
        paragraphs: [
          "To the fullest extent permitted by law, Identity Scaffolding LLC and its members, managers, officers, employees, and agents will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, or business interruption arising from the hosted service.",
          "To the fullest extent permitted by law, their total liability for all claims arising from the hosted service will not exceed the greater of 100 US dollars or the amount the user paid Identity Scaffolding LLC for the hosted service during the 12 months before the event giving rise to the claim. Nonwaivable consumer rights remain unaffected.",
        ],
      },
      {
        title: "Governing law and disputes",
        paragraphs: [
          "New York law governs these Terms, without regard to conflict-of-law rules, subject to nonwaivable consumer protections.",
          "Before filing a claim, the user and Identity Scaffolding LLC will try in good faith to resolve it informally through written notice to the contact below. If the dispute is not resolved, either party may proceed in a court of competent jurisdiction in New York State. These Terms require neither arbitration nor a waiver of class-action rights.",
        ],
      },
      {
        title: "Severability and changes",
        paragraphs: [
          "If a court finds part of these Terms unenforceable, the remaining parts remain in effect, and the unenforceable part will apply to the maximum extent permitted by law. A failure to enforce a provision is not a waiver.",
          "Identity Scaffolding LLC may update these Terms when the service or law changes. A material update will receive a new date and any notice required by law. Continued use after an update takes effect constitutes acceptance where permitted by law.",
        ],
      },
      {
        title: "Contact",
        paragraphs: [
          "Questions, privacy requests, and informal dispute notices may be sent to privacy@identityscaffolding.com or mailed to Identity Scaffolding LLC, 30 N Gould St Ste R, Sheridan, WY 82801.",
        ],
      },
    ],
  },
  trust: {
    title: "Trust",
    summary:
      "Current, bounded evidence for one named Cadence source commit and its production deployments.",
    updated: "August 27, 2026",
    sections: [
      {
        title: "Data boundaries",
        paragraphs: [
          "Cadence stores account and behavior records in Supabase. Row Level Security scopes user-owned records to the authenticated account.",
          "Cadence does not send exported behavior data to an AI provider. Users choose whether to share an export with an external service. Optional Daily Brief separately sends disclosed context to OpenAI. Local connector tests do not verify live providers, installed desktop behavior or deployment.",
        ],
      },
      {
        title: "Public source and license",
        paragraphs: [
          "Cadence source code is public at github.com/emixd12/cadence under the repository's MIT license.",
          "The public source lets anyone inspect the implementation. It does not independently verify a hosted deployment.",
        ],
      },
      {
        title: "Limits of verification",
        paragraphs: [
          "Each result covers only its named scope, source commit, deployments, and verification time. A Passed result is not a certification or a guarantee that defects are absent.",
          "Provider configuration, later changes, untested workflows, and private operational records remain outside a result unless its scope states otherwise.",
        ],
      },
    ],
  },
};

export function LegalPageContent({
  pageKey,
  children,
}: Readonly<{
  pageKey: LegalPageKey;
  children?: ReactNode;
}>) {
  const page = LEGAL_PAGES[pageKey];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <nav
        aria-label="Legal pages"
        className="flex flex-wrap gap-2 border-b border-line pb-4 text-sm leading-6"
      >
        {LEGAL_PAGE_ORDER.map((key) => {
          const item = LEGAL_PAGES[key];

          return (
            <a
              key={key}
              href={`/${key}`}
              aria-current={key === pageKey ? "page" : undefined}
              className={[
                "product-action py-2 text-sm",
                key === pageKey
                  ? "product-action-primary"
                  : "product-action-secondary",
              ].join(" ")}
            >
              {item.title}
            </a>
          );
        })}
      </nav>

      <header className="border-b border-line pb-6">
        <p className="text-sm leading-6 text-muted-readable">
          Last updated {page.updated}
        </p>
        <h1 className="mt-3 text-3xl leading-tight sm:text-4xl">
          {page.title}
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-readable">
          {page.summary}
        </p>
      </header>

      {children}

      <div className="grid divide-y divide-line">
        {page.sections.map((section) => (
          <section key={section.title} className="py-6 first:pt-0 last:pb-0">
            <h2 className="text-2xl leading-tight">{section.title}</h2>
            <div className="mt-4 grid max-w-3xl gap-3 text-base leading-7 text-muted-readable">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items ? (
                <ul className="grid gap-2 pl-5">
                  {section.items.map((item) => (
                    <li key={item} className="list-disc">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.links?.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="product-action product-action-secondary justify-self-start py-2 text-sm"
                >
                  {link.label}
                </a>
              ))}
              {section.table ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm leading-6">
                    <caption className="sr-only">
                      {section.table.caption}
                    </caption>
                    <thead>
                      <tr className="border-b border-line">
                        {section.table.headers.map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="px-3 py-2 font-semibold text-ink first:pl-0"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr
                          key={row.join("|")}
                          className="border-b border-line align-top last:border-0"
                        >
                          {row.map((cell, index) => (
                            <td
                              key={`${index}-${cell}`}
                              className="px-3 py-3 first:pl-0"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <footer className="flex flex-wrap gap-3 text-sm leading-6">
        <a
          href={MARKETING_SITE_URL}
          className="product-action product-action-secondary py-2"
        >
          Cadence overview
        </a>
        <a href="/login" className="product-action product-action-primary py-2">
          Sign in
        </a>
        <a
          href="/settings"
          className="product-action product-action-secondary py-2"
        >
          Open settings
        </a>
      </footer>
    </main>
  );
}
