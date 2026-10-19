import { buildFaqMarkdown } from "./faq";
import { siteConfig } from "./site";
import { exportFormats, statusDefinitions } from "./vocabulary";

export type MarketingRoute = {
  routeId: string;
  path: `/${string}` | "/";
  markdownPath: `/${string}.md`;
  type:
    | "landing"
    | "product"
    | "standard"
    | "documentation"
    | "example"
    | "about"
    | "faq";
  title: string;
  navLabel: string;
  description: string;
  lastModified: string;
  includeInSitemap: boolean;
  includeInLlms: boolean;
  includeInMarkdownMirror: boolean;
  markdown: string;
};

export const marketingRoutes = [
  {
    routeId: "home",
    path: "/",
    markdownPath: "/index.md",
    type: "landing",
    title: "Cadence",
    navLabel: "Home",
    description:
      "Cadence is an open-source behavior tracker where you decide every occurrence and export your full history as a portable BehaviorLog bundle.",
    lastModified: siteConfig.lastModified,
    includeInSitemap: true,
    includeInLlms: true,
    includeInMarkdownMirror: true,
    markdown: `# Cadence

Cadence is an open-source personal behavior tracker. You define Behaviors with Schedules, and Cadence generates Occurrences on a today-first timeline. ${statusDefinitions.completed} ${statusDefinitions.notCompleted} ${statusDefinitions.unresolved} Prior-day Unresolved Occurrences surface in Needs decision. The full history exports as ${exportFormats.join(", ")}.

## How Cadence Works

1. Define a behavior with a title and a schedule: daily, every N days, weekly, or monthly, at exact times or time ranges. Categories, descriptions, and reminders are optional.
2. Each Schedule produces Occurrences on a today-first timeline. Prior-day Unresolved Occurrences collect in Needs decision.
3. Make a Decision for each Occurrence, with an optional note. Every Decision writes an append-only status event.
4. Review adherence across 7, 30, or 90 days on a calendar heatmap, then export the full history anytime.
5. See your behaviors in context. Optional connectors bring context from other tools into your Timeline. See events alongside recurring behaviors to spot overlaps with the rest of your day. Google Calendar provides optional read-only context. Outlook Calendar, iCloud Calendar and Hevy workout timing have local verification only; live providers, installed desktop and release remain unverified.

## Philosophy

Cadence deliberately has no streaks, badges, points, or guilt mechanics. Streaks collapse effort into one number that resets on one bad day. Cadence shows Adherence across 7, 30, or 90 days instead. ${statusDefinitions.unresolved} Silence is never converted into failure. The product records facts about behavioral Adherence and leaves motivation to the user.

Interfaces are no longer fixed: in the agentic era, an AI tool can read a personal history and build whatever View or coaching layer its owner prefers. Cadence therefore invests in the data backbone, a factual and portable Record, rather than a prescribed interface.

You choose whether to share exports with an external AI service. Separately, where enabled, optional Daily Brief sends disclosed context to OpenAI. Each connected source needs its own model-data choice.

## Time Tracking

Any current-day Occurrence, or one visible in Needs decision, can carry an elapsed-time timer with start, stop, and reset. Reviews show per-Occurrence totals and range averages alongside Adherence. Exports omit time-tracking data unless the user explicitly opts in because exact session timestamps can reveal activity patterns.

## Read First

- Use Cadence to track recurring behaviors one account at a time.
- Use BehaviorLog when a behavior history needs to move between tools without losing local dates, timezones, or explicit status history.
- Status values are unresolved, completed, and not_completed.
- Needs decision is a derived Cadence UI group, not a stored BehaviorLog status.
`,
  },
  {
    routeId: "faq",
    path: "/faq",
    markdownPath: "/faq.md",
    type: "faq",
    title: "Frequently Asked Questions",
    navLabel: "FAQ",
    description:
      "Detailed answers about Cadence's recording model, context and history, review and analysis, privacy, and portability.",
    lastModified: siteConfig.lastModified,
    includeInSitemap: true,
    includeInLlms: true,
    includeInMarkdownMirror: true,
    markdown: buildFaqMarkdown(),
  },
  {
    routeId: "examples",
    path: "/examples",
    markdownPath: "/examples.md",
    type: "example",
    title: "Example BehaviorLog Bundle",
    navLabel: "Examples",
    description:
      "Download a sanitized Cadence-generated BehaviorLog-style example bundle and inspect the files agents should read first.",
    lastModified: siteConfig.lastModified,
    includeInSitemap: true,
    includeInLlms: true,
    includeInMarkdownMirror: true,
    markdown: `# Example BehaviorLog Bundle

The example bundle is generated from demo behavior data and is intended for format inspection, tests, and agent workflows. It contains no real account or reminder-provider data.

## Included Concepts

- Behavior records.
- Calendar-simple schedules.
- Occurrences with local_date, timezone, and current status.
- Status event history.
- A short AGENTS.md file that tells coding agents how to inspect the bundle.

Download path: ${siteConfig.exampleBundlePath}
`,
  },
  {
    routeId: "docs",
    path: "/docs",
    markdownPath: "/docs.md",
    type: "documentation",
    title: "Cadence Docs",
    navLabel: "Docs",
    description:
      "Technical entry points for Cadence, BehaviorLog bundles, machine-readable mirrors, and future docs structure.",
    lastModified: siteConfig.lastModified,
    includeInSitemap: true,
    includeInLlms: true,
    includeInMarkdownMirror: true,
    markdown: `# Cadence Docs

This route is optimized for coding agents, retrieval tools, and developers evaluating Cadence exports. Prefer the Markdown mirrors and route manifest when context budget matters.

## Machine Files

- ${siteConfig.trustUrl} is the canonical human Trust page.
- ${siteConfig.trustEvidenceUrl} is the normalized current Trust evidence route.
- /llms.txt is the curated agent index.
- /llms-full.txt contains scoped page text for this small marketing site.
- /data/route-manifest.json is the source route manifest exposed as JSON.
- /faq.md, /examples.md, /docs.md, /about.md, and /index.md are clean Markdown mirrors.
- /sitemap.xml lists canonical HTML routes.
- /robots.txt advertises the sitemap.

## Analysis Rule

Use status_events.jsonl as the BehaviorLog history authority. Treat occurrences.jsonl current_status as a snapshot only.

Adherence includes only decided Occurrences. Unresolved Occurrences remain separate. Do not infer causes, clinical meaning, or motivation from a Record.

You choose whether to share exports with an external AI service. Separately, where enabled, optional Daily Brief sends disclosed context to OpenAI. Each connected source needs its own model-data choice.

## Canonical Application Pages

- ${siteConfig.trustUrl} is canonical HTML for Trust.
- ${siteConfig.cadenceAppUrl}/privacy is canonical HTML for Privacy.
- ${siteConfig.cadenceAppUrl}/terms is canonical HTML for Terms.

These application-origin pages are not marketing routes and have no marketing Markdown mirrors.
`,
  },
  {
    routeId: "about",
    path: "/about",
    markdownPath: "/about.md",
    type: "about",
    title: "About Cadence",
    navLabel: "About",
    description:
      "Cadence's behavioral-remodeling philosophy, Record principles, current product scope, vocabulary, and implementation links.",
    lastModified: siteConfig.lastModified,
    includeInSitemap: true,
    includeInLlms: true,
    includeInMarkdownMirror: true,
    markdown: `# About Cadence

Behavioral remodeling starts with a Record the user controls. Cadence records recurring behavior through explicit Decisions, preserved Context, longitudinal review, and portable BehaviorLog data.

## Behavioral Remodeling

A Behavior can change over time. Cadence keeps its Schedule, Occurrences, Decisions, and optional Context available for review. JSON and BehaviorLog exports preserve title and description definition history; Cadence does not present a full in-app revision browser. ${statusDefinitions.completed} ${statusDefinitions.notCompleted} ${statusDefinitions.unresolved}

## Four Record Principles

1. Explicit Decisions: only the user declares an Occurrence Completed or Not Completed.
2. Preserved Context: notes and elapsed time do not rewrite an earlier Decision. JSON and BehaviorLog exports preserve title and description definition history.
3. Longitudinal review: Cadence separates Unresolved Occurrences and shows Adherence across 7, 30, or 90 days.
4. Portable Records: export the Record as ${exportFormats.join(", ")}.

## Current Product Scope

Cadence is a single-player web app for Behavior creation, recurring Schedules, a timeline of Occurrences, explicit Decisions, notes, reminders, basic Adherence review, elapsed-time capture, and portable exports. It is not a social tracker, collaboration product, medical dosing app, payment system, or AI coach.

You choose whether to share exports with an external AI service. Separately, where enabled, optional Daily Brief sends disclosed context to OpenAI. Each connected source needs its own model-data choice.

## Cadence and BehaviorLog

Cadence is the application where a user creates and reviews a Record. BehaviorLog is the open standard that packages behavior Records for inspection and exchange between tools.

## Implementation

- Cadence source: ${siteConfig.githubUrl}
- BehaviorLog standard: ${siteConfig.standardUrl}
- Trust: ${siteConfig.trustUrl}
- Privacy: ${siteConfig.cadenceAppUrl}/privacy
`,
  },
] as const satisfies MarketingRoute[];

export type MarketingRouteId = (typeof marketingRoutes)[number]["routeId"];

export function getRouteById(routeId: MarketingRouteId): MarketingRoute {
  const route = marketingRoutes.find((entry) => entry.routeId === routeId);

  if (!route) {
    throw new Error(`Unknown marketing route: ${routeId}`);
  }

  return route;
}

export function getCanonicalUrl(path: string): string {
  return new URL(path, siteConfig.marketingSiteUrl).toString();
}

export function getRouteManifest() {
  return marketingRoutes.map((route) => ({
    url: getCanonicalUrl(route.path),
    route_id: route.routeId,
    type: route.type,
    title: route.title,
    description: route.description,
    canonical_url: getCanonicalUrl(route.path),
    markdown_url: getCanonicalUrl(route.markdownPath),
    last_modified: route.lastModified,
    language: siteConfig.language,
    is_public: true,
    include_in_sitemap: route.includeInSitemap,
    include_in_llms: route.includeInLlms,
    include_in_feed: false,
    include_in_markdown_mirror: route.includeInMarkdownMirror,
    source_path: `src/pages${route.path === "/" ? "/index" : route.path}.astro`,
  }));
}

export function markdownWithFrontmatter(route: MarketingRoute): string {
  return [
    "---",
    `title: ${JSON.stringify(route.title)}`,
    `description: ${JSON.stringify(route.description)}`,
    `canonical_url: ${getCanonicalUrl(route.path)}`,
    `last_updated: ${route.lastModified}`,
    "status: stable",
    `source: src/pages${route.path === "/" ? "/index" : route.path}.astro`,
    "---",
    "",
    route.markdown.trim(),
    "",
  ].join("\n");
}
