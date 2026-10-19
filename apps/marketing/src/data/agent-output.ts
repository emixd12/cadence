import {
  getCanonicalUrl,
  getRouteManifest,
  markdownWithFrontmatter,
  marketingRoutes,
} from "./routes";
import { siteConfig } from "./site";

export function getLlmsTxt(): string {
  const lines = [
    "# Cadence",
    "",
    "> Cadence is an open personal behavior tracker. BehaviorLog is the open bundle standard behind portable Cadence exports.",
    "",
    "## Start Here",
    "- [Cadence homepage](/index.md): Product model, boundaries, and portability role.",
    "- [Frequently Asked Questions](/faq.md): Product philosophy, privacy, time tracking, and portability answers.",
    "- [Cadence docs](/docs.md): Machine files, route manifest, and rules for coding agents.",
    "- [Example bundle](/examples.md): Sanitized sample bundle for inspection.",
    "- [About Cadence](/about.md): Recording principles, scope, and vocabulary.",
    "",
    "## Developers",
    ...marketingRoutes.filter((route) => route.path.startsWith("/developers") && route.includeInLlms).map((route) => `- [${route.title}](${route.markdownPath}): ${route.description}`),
    "",
    "## Machine-Readable Files",
    `- [Trust evidence](${siteConfig.trustEvidenceUrl}): Normalized current results for all nine public checks.`,
    "- [Route manifest](/data/route-manifest.json): Canonical route data used by generated outputs.",
    "- [Full text bundle](/llms-full.txt): Small scoped text dump with page boundaries.",
    "- [Sitemap](/sitemap.xml): Canonical HTML routes.",
    "- [Robots](/robots.txt): Crawl policy and sitemap pointer.",
    "",
    "## Project Links",
    `- [Trust](${siteConfig.trustUrl}): Durable commitments and current bounded verification results.`,
    `- [Privacy](${siteConfig.cadenceAppUrl}/privacy): Canonical hosted privacy notice.`,
    `- [Terms](${siteConfig.cadenceAppUrl}/terms): Canonical hosted terms.`,
    `- [Cadence repository](${siteConfig.githubUrl}): Product implementation.`,
    `- [Try Cadence](${siteConfig.cadenceAppUrl}/login): Authenticated web app.`,
    `- [BehaviorLog Bundle repository](${siteConfig.standardUrl}): Upstream standard.`,
    "",
    "## Notes for Agents",
    "- Behavior is the recurring thing; Schedule defines when; Occurrence is one scheduled instance; Decision is the user's explicit status choice; Context adds notes or timing; Record preserves the history; View presents it; BehaviorLog makes it portable.",
    "- Prefer .md mirrors for context budget.",
    "- Cite canonical HTML URLs for human-facing answers.",
    "- Use data/status_events.jsonl as the BehaviorLog history authority.",
    "- Treat occurrences.jsonl current_status as a snapshot.",
    "- Do not infer failure from unresolved status.",
    "- Calculate Adherence from decided Occurrences only. Keep Unresolved separate.",
    "- Do not infer causes, clinical meaning, or motivation from a Record.",
    "- Exported data goes to an external service only when the user chooses it. MCP access is consent-based; hosted launch remains pending. See /developers/data-and-privacy.md.",
    "- Do not treat the example bundle as real account data.",
    "",
  ];

  return lines.join("\n");
}

export function getLlmsFullTxt(): string {
  const lines = [
    "# Cadence Full Agent Text",
    "",
    `Generated from route manifest. Last updated: ${siteConfig.lastModified}.`,
    "",
    "Full guide text follows. Generated tool references have separate Markdown mirrors linked below to keep this file bounded.",
    `Canonical Trust page: ${siteConfig.trustUrl}`,
    `Normalized Trust evidence: ${siteConfig.trustEvidenceUrl}`,
    `Canonical Privacy HTML: ${siteConfig.cadenceAppUrl}/privacy`,
    `Canonical Terms HTML: ${siteConfig.cadenceAppUrl}/terms`,
    "Legal and Trust pages are application routes, not marketing routes, and have no Markdown mirrors.",
    "",
  ];

  for (const route of marketingRoutes) {
    lines.push(
      `## Source: ${route.path}`,
      `Canonical: ${getCanonicalUrl(route.path)}`,
      `Markdown: ${getCanonicalUrl(route.markdownPath)}`,
      `Last updated: ${route.lastModified}`,
      "",
      route.path.startsWith("/developers/tools/") ? `${route.description} Read the full reference: ${getCanonicalUrl(route.markdownPath)}` : route.markdown.trim(),
      "",
    );
  }

  return lines.join("\n");
}

export function getSitemapXml(): string {
  const urls = getRouteManifest()
    .filter((route) => route.include_in_sitemap)
    .map((route) =>
      [
        "  <url>",
        `    <loc>${escapeXml(route.canonical_url)}</loc>`,
        `    <lastmod>${route.last_modified}</lastmod>`,
        "  </url>",
      ].join("\n"),
    );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- Generated from route manifest. Do not edit manually. -->",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function getRobotsTxt(): string {
  return [
    "# Generated from route manifest. Do not edit manually.",
    "# Ticket 031 uses a max-visibility public marketing posture.",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${getCanonicalUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}

export function getRouteManifestJson(): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      generated_from: "apps/marketing/src/data/routes.ts",
      routes: getRouteManifest(),
    },
    null,
    2,
  )}\n`;
}

export function getMarkdownMirror(routeId: string): string {
  const route = marketingRoutes.find((entry) => entry.routeId === routeId);

  if (!route) {
    throw new Error(`Unknown route mirror: ${routeId}`);
  }

  return markdownWithFrontmatter(route);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
