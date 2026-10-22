import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("marketing base layout", () => {
  it("makes the main landmark a focus target for the skip link", () => {
    const source = readFileSync(
      "apps/marketing/src/layouts/BaseLayout.astro",
      "utf8",
    );

    expect(source).toContain(
      '<a class="skip-link" href="#main">Skip to content</a>',
    );
    expect(source).toContain('<main id="main" tabindex="-1">');
  });

  it("keeps the header and footer minimal", () => {
    const source = readFileSync("apps/marketing/src/layouts/BaseLayout.astro", "utf8");

    expect(source).toContain("primaryCtas.logIn.label");
    expect(source).toContain("primaryCtas.downloadMac.label");
    expect(source).toContain('aria-label="Project links"');
    expect(source).toContain('aria-label="Trust and legal links"');
    expect(source).toContain("siteConfig.trustUrl");
    expect(source).toContain("siteConfig.cadenceAppUrl}/privacy");
  });

  it("links the header macOS download to the signed stable DMG", () => {
    const site = readFileSync("apps/marketing/src/data/site.ts", "utf8");

    expect(site).toContain('label: "Download for Mac"');
    expect(site).toContain(
      "releases/download/desktop-stable/Cadence_0.1.3_aarch64.dmg",
    );
    expect(site).not.toContain("releases/download/desktop-preview/");
  });
});
