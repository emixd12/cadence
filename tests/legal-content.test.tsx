import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { LegalPageContent } from "../components/settings/LegalContent";
import { TrustAndLegalPanel } from "../components/settings/SettingsPanels";

vi.mock("../lib/marketing-site", () => ({
  MARKETING_SITE_URL: "https://cadence-me.com",
}));

describe("trust and legal UI content", () => {
  it("renders sparse public legal routes without adding product drift language", () => {
    const html = renderToStaticMarkup(<LegalPageContent pageKey="trust" />);

    expect(html).toContain("Data boundaries");
    expect(html).toContain("Public source and license");
    expect(html).toContain("Limits of verification");
    expect(html).toContain("Row Level Security scopes user-owned records");
    expect(html).toContain(
      "does not send exported behavior data to an AI provider",
    );
    expect(html).toContain("under the repository&#x27;s MIT license");
    expect(html).not.toContain("Manual truth");
    expect(html).not.toContain("dashboard");
    expect(html).not.toContain("missed status");
    expect(html).not.toContain("expected to stay scoped");
  });

  it("links the legal pages together", () => {
    const html = renderToStaticMarkup(<LegalPageContent pageKey="privacy" />);

    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/trust"');
    expect(html).toContain('href="https://cadence-me.com"');
    expect(html).toContain("Cadence overview");
    expect(html).toContain("delete their account in Settings");
  });

  it("renders the approved Privacy policy with processor and retention tables", () => {
    const html = renderToStaticMarkup(<LegalPageContent pageKey="privacy" />);

    expect(html).toContain("October 18, 2026");
    expect(html).not.toContain("draft");
    expect(html).not.toContain("not legally approved");
    expect(html).toContain("Cadence service providers and purposes");
    expect(html).toContain("Microsoft 365");
    expect(html).toContain("Privacy, support, and dispute correspondence");
    expect(html).toContain("Cadence retention periods");
    expect(html).toContain("<table");
    expect(html).toContain('<th scope="col"');
    expect(html).toContain("Vercel Pro runtime logs: 1 day");
    expect(html).toContain("Supabase Pro API and database logs: 7 days");
    expect(html).toContain("Browser-push payloads");
    expect(html).toContain("24-hour TTL");
    expect(html).toContain("deleted within 30 days after account termination");
    expect(html).toContain("Microsoft 365 mailbox retention is configured");
    expect(html).toContain("privacy@identityscaffolding.com");
    expect(html).toContain("California disclosures");
    expect(html).toContain("only for people age 18 or older");
    expect(html).toContain("does not send behavior data to an AI provider");
    expect(html).toContain("Limited Use requirements");
    expect(html).toContain(
      'href="https://developers.google.com/terms/api-services-user-data-policy"',
    );
    expect(html).toContain("review of Calendar access is pending");
    expect(html).not.toContain("currently limited to Google OAuth test users");
  });

  it("renders the approved Terms with the settled legal facts", () => {
    const html = renderToStaticMarkup(<LegalPageContent pageKey="terms" />);

    expect(html).toContain("Identity Scaffolding LLC");
    expect(html).toContain("30 N Gould St Ste R, Sheridan, WY 82801");
    expect(html).toContain("General-purpose recordkeeping");
    expect(html).toContain("Source license and other rights");
    expect(html).toContain(
      "repository license governs only material within its stated scope",
    );
    expect(html).toContain("New York law governs");
    expect(html).toContain(
      "require neither arbitration nor a waiver of class-action rights",
    );
    expect(html).toContain("greater of 100 US dollars");
    expect(html).not.toContain("draft");
    expect(html).not.toContain("not legally approved");
  });

  it("renders each public account-information destination from Settings", () => {
    const html = renderToStaticMarkup(<TrustAndLegalPanel />);

    expect(html).toContain('href="/trust"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });
});
