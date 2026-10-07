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
    updated: "September 21, 2026",
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
          "The Google Calendar connector is optional. Google's review of Calendar access is pending; the connector is not yet verified for public rollout. Where enabled, it requires separate read-only consent for the same Google account used to sign in. Cadence reads your subscribed calendar list so you can choose calendars, then reads events from selected calendars intersecting displayed days, including readable titles, descriptions, times, locations, organizers, attendees, conference details, attachment links, and Google event links. It does not create, edit, or delete Google events or download attachments automatically.",
          "Cadence uses Calendar information to show selected events in Timeline and provide advisory overlap context. It does not sell Calendar information, use it for advertising, or send it to AI providers.",
          "Vercel runtime processes Calendar API requests and returned event details while serving a refresh. Supabase stores the account's connector status, calendar selections, display preferences, and encrypted Google refresh credential. Cadence does not store Google event details in its hosted database. The web app holds returned event details in memory. Desktop can store the last complete normalized event snapshot in a separate account-bound cache for offline display; its account session and pending consent state use macOS Keychain.",
          "Calendar details and credentials are excluded from Cadence exports, account synchronization, and user-created desktop tracking backups. Supabase daily infrastructure backups can retain deleted connector records and sealed credential ciphertext for no more than seven days.",
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
        title: "Exports and external AI services",
        paragraphs: [
          `Cadence provides ${exportFormats.join(", ")} exports. The user chooses when and where to download or share an export.`,
          "Cadence provides prepared prompts, but it does not send behavior data to an AI provider. If a user shares an export or prompt with an external AI service, that service's terms and privacy policy govern its processing.",
        ],
      },
      {
        title: "Travel routing",
        paragraphs: [
          "Travel routing is disabled in the current release. Cadence does not send locations to a routing provider while it is disabled. An explicit device-location permission check may read one foreground sample on this device and does not send that sample anywhere.",
          "Before a future release can enable travel routing, Cadence must obtain separate routing consent. The feature would use a selected transport mode and a foreground current location only when permitted. An optional saved base would support final-return estimates. Cadence would send only route endpoints, selected mode, and route time to Google Maps. It would not send Calendar titles, notes, emails, account IDs, Calendar credentials, or raw Calendar payloads.",
          "Cadence keeps current user-authored locations until the user edits or removes them. Behavior configuration history and existing backups can retain earlier locations. It would not store device samples, geocodes, or route responses in Cadence sync, exports, backups, analytics, or logs. Disabling routing would stop new requests and clear transient travel evidence. A routing provider may process requests under its own terms and retention policies.",
        ],
      },
      {
        title: "How Cadence uses data",
        paragraphs: [
          "Cadence uses data to authenticate accounts, generate scheduled Occurrences, display records, save explicit Decisions and notes, provide optional timing, send configured reminders, calculate basic analytics, create exports, secure the service, prevent abuse, diagnose failures, and respond to requests.",
          "Cadence does not sell personal information or share it for cross-context behavioral advertising. Cadence does not automatically turn an Unresolved Occurrence into a failure.",
        ],
      },
      {
        title: "Processors",
        paragraphs: [
          "Cadence uses the following service providers for the stated purposes. A provider processes data under its own service terms and the operator's configuration.",
        ],
        table: {
          caption: "Cadence service providers and purposes",
          headers: ["Provider", "Purpose", "Data involved"],
          rows: [
            [
              "Vercel",
              "Application and marketing hosting, including Calendar refresh processing",
              "Request and runtime data, including returned Calendar details during a refresh",
            ],
            [
              "Supabase",
              "Google authentication and database storage",
              "Account and Cadence records, Calendar connector records, selections, and sealed credential ciphertext",
            ],
            [
              "Google",
              "User-selected Google sign-in and optional Google Calendar consent and API access",
              "Google account, authentication, selected-calendar, and readable event data",
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
          ],
        },
      },
      {
        title: "Retention",
        paragraphs: [
          "Cadence uses the retention periods below. A provider may delete data sooner. Specific records may be kept longer when required for a security investigation, fraud prevention, or legal preservation.",
          "Provider settings and published capabilities were verified before this policy took effect.",
        ],
        table: {
          caption: "Cadence retention periods as of August 31, 2026",
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
              "No more than 7 days",
              "Supabase Pro daily backups: 7 days",
            ],
            [
              "Deleted-account live data",
              "Immediately or within 7 days",
              "Auth deletion and database cascades remove live account data immediately when deletion succeeds",
            ],
            [
              "Deleted-account backup remnants",
              "No more than 7 days",
              "Supabase daily backups: 7 days",
            ],
            [
              "Google Calendar connector records",
              "Live credential until Calendar disconnect, access revocation, or account deletion; connector status and preferences until account deletion",
              "Disconnect deletes the live credential; Supabase daily backup remnants retain for no more than 7 days",
            ],
            [
              "Desktop Google Calendar cache",
              "Until replacement, Calendar disconnect, Cadence account disconnect or reconnect, or local app-data removal",
              "Separate local cache; excluded from Cadence exports, account synchronization, and user-created desktop backups",
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
    updated: "September 21, 2026",
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
        title: "Exports and external prompts",
        paragraphs: [
          `Cadence provides ${exportFormats.join(", ")} exports. The user is responsible for safeguarding downloaded files and deciding whether to share them.`,
          "Cadence may provide prepared prompts. The user selects any external AI service and sends data independently. Cadence does not send behavior data to an AI provider, and external services operate under their own terms and privacy policies.",
        ],
      },
      {
        title: "Travel routing limits",
        paragraphs: [
          "Travel routing is disabled in the current release. If Cadence later enables it with separate consent, route estimates will be planning information only. They can be unavailable, late, incomplete, or wrong and do not promise a route, arrival time, transit connection, parking, accessibility, or safety.",
          "A user must not rely on Cadence travel estimates for emergency response, safety-critical travel, medical care, legal deadlines, or navigation. The user remains responsible for choosing a route and checking current conditions.",
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
          "Cadence does not send exported behavior data to an AI provider. Users choose whether to share an export with an external service.",
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
