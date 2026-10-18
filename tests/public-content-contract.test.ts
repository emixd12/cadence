import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { faqItems } from "../apps/marketing/src/data/faq";
import { marketingRoutes } from "../apps/marketing/src/data/routes";
import { siteConfig } from "../apps/marketing/src/data/site";
import {
  exportFormats,
  statusDefinitions,
  vocabulary,
} from "../apps/marketing/src/data/vocabulary";
import { LEGAL_PAGES } from "../components/settings/LegalContent";

const publicCopy = [
  siteConfig.description,
  ...faqItems.flatMap(({ question, answer }) => [question, answer]),
  ...marketingRoutes.flatMap(({ path, description, markdown }) => [
    description,
    // These exact names come from the approved plugin and operation registry.
    path === "/developers/plugins" ? markdown.replaceAll("Daily check-in", "Daily review")
      : path === "/developers/tools/list_occurrences" ? markdown.replaceAll("habit check-in", "habit occurrence") : markdown,
  ]),
  JSON.stringify(LEGAL_PAGES),
  ...[
    "README.md",
    "apps/marketing/src/layouts/BaseLayout.astro",
    "apps/marketing/src/pages/index.astro",
    "apps/marketing/src/pages/faq.astro",
    "apps/marketing/src/pages/about.astro",
    "apps/marketing/src/pages/docs.astro",
    "apps/marketing/src/components/HeroVisual.astro",
    "apps/marketing/src/components/HowItWorks.astro",
    "apps/marketing/src/components/ProductCapture.astro",
  ].map((path) => readFileSync(resolve(path), "utf8")),
].join("\n");

const home = marketingRoutes.find(
  ({ routeId }) => routeId === "home",
)!.markdown;
const about = marketingRoutes.find(
  ({ routeId }) => routeId === "about",
)!.markdown;
const statusSurfaces = [
  home,
  buildFaqCopy(),
  about,
  JSON.stringify(LEGAL_PAGES.terms),
];
const exportSurfaces = [
  home,
  buildFaqCopy(),
  JSON.stringify(LEGAL_PAGES.privacy),
  JSON.stringify(LEGAL_PAGES.terms),
];

describe("public content contract", () => {
  it("keeps AI disclosure consistent in marketing HTML owners and Markdown mirrors", () => {
    const answer = faqItems.find(({ id }) => id === "use-external-ai")!.answer;
    const aboutSource = readFileSync(resolve("apps/marketing/src/pages/about.astro"), "utf8");
    for (const copy of [answer, home, about, buildFaqCopy(), aboutSource]) {
      expect(copy).toContain(answer);
      expect(copy).toContain("Daily Brief separately sends selected tracking information to OpenAI");
      expect(copy).toContain("Calendar data is never shared through MCP");
      expect(copy).toContain("Hosted MCP launch remains pending");
      expect(copy).not.toContain("does not send behavior data to an AI provider");
    }
  });

  it("keeps vocabulary, statuses, and exports canonical", () => {
    const bannedPhrases = [
      "complete JSON snapshot",
      "full JSON",
      "Markdown summary",
      "permanently free",
      "automatic AI analysis",
    ];
    const occurrenceSynonyms = ["check-in", "scheduled slot", "scheduled item"];

    expect(publicCopy).not.toContain("—");
    for (const phrase of [...bannedPhrases, ...occurrenceSynonyms]) {
      expect(publicCopy.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    expect(vocabulary.map(({ term }) => term)).toEqual([
      "Behavior",
      "Schedule",
      "Occurrence",
      "Decision",
      "Completed",
      "Not Completed",
      "Unresolved",
      "Context",
      "Revision",
      "Adherence",
      "Record",
      "View",
      "BehaviorLog",
    ]);
    for (const definition of Object.values(statusDefinitions)) {
      for (const surface of statusSurfaces)
        expect(surface).toContain(definition);
    }
    expect(exportFormats).toEqual([
      "JSONL",
      "JSON",
      "CSV",
      "Markdown",
      "BehaviorLog bundle",
    ]);
    for (const surface of exportSurfaces) {
      expect(surface).toContain(exportFormats.join(", "));
    }
  });
});

function buildFaqCopy(): string {
  return faqItems
    .flatMap(({ question, answer }) => [question, answer])
    .join("\n");
}
