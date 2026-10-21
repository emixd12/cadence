import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { LEGAL_PAGES, LegalPageContent } from "../components/settings/LegalContent";
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
    expect(html).not.toContain("does not send behavior data to an AI provider");
    expect(html).not.toContain("Provider settings and published capabilities were verified");
    expect(html).toContain("Limited Use requirements");
    expect(html).toContain(
      'href="https://developers.google.com/terms/api-services-user-data-policy"',
    );
    expect(html).toContain("review of Calendar access is pending");
    expect(html).not.toContain("currently limited to Google OAuth test users");
  });

  it("separates connected-client permissions, retained copies, and Daily Brief consent", () => {
    const privacy = JSON.stringify(LEGAL_PAGES.privacy);
    const terms = JSON.stringify(LEGAL_PAGES.terms);
    for (const copy of [privacy, terms]) {
      expect(copy).toContain("Exports and connected AI clients");
      expect(copy).toContain("Optional Daily Brief");
      expect(copy).toContain("Calendar data");
      expect(copy).toContain("never shared through MCP");
      expect(copy).not.toContain("does not send behavior data to an AI provider");
    }
    for (const disclosure of [
      "user-authored Behavior locations", "Read access is not limited to records you mention",
      "MCP provides no delete operation", "the AI client controls its per-action confirmation",
      "retrieve copies already received by the client", "Daily Brief consent does not authorize MCP access",
      "up to 12 Notes, the first 280 characters of each", "never reminder content",
      "does not promise zero provider retention",
    ]) expect(privacy).toContain(disclosure);
  });

  it("distinguishes validity, physical cleanup, and shared registration retention", () => {
    const privacy = JSON.stringify(LEGAL_PAGES.privacy);
    for (const disclosure of [
      "90-day policy", "24-hour validity", "it does not mean immediate physical deletion",
      "Failed maintenance can extend storage", "no automatic deletion deadline",
      "does not remove a shared client registration", "live account-owned integration records",
    ]) expect(privacy).toContain(disclosure);
    expect(LEGAL_PAGES.privacy.updated).toBe("October 18, 2026");
    expect(LEGAL_PAGES.terms.updated).toBe("October 18, 2026");
    expect(LEGAL_PAGES.trust.updated).toBe("August 27, 2026");
    expect(LEGAL_PAGES.privacy.sections.find(({ title }) => title === "Retention")?.table?.caption)
      .toBe("Cadence retention periods as of October 18, 2026");
  });

  it("discloses backup lifecycle without changing live deletion or ordinary log periods", () => {
    const privacy = LEGAL_PAGES.privacy;
    const retention = privacy.sections.find(({ title }) => title === "Retention");
    const rows = retention?.table?.rows ?? [];
    const approved = "Supabase maintains database backups. Deleted records may remain in backup copies until Supabase removes those copies under its backup lifecycle. Live-record deletion does not immediately erase existing backups.";

    expect(retention?.paragraphs).toContain(approved);
    expect(renderToStaticMarkup(<LegalPageContent pageKey="privacy" />)).toContain(approved);
    for (const name of ["Backups", "Deleted-account backup remnants", "Google Calendar connector records", "Travel place identifiers"]) {
      const row = rows.find(([label]) => label === name);
      expect(row).toBeDefined();
      expect(row?.join(" ")).toContain("backup lifecycle");
      expect(row?.join(" ")).not.toMatch(/(?:7|seven) days/);
    }
    const calendar = privacy.sections.find(({ title }) => title === "Optional Google Calendar");
    expect(calendar?.paragraphs.join(" ")).toContain("sealed credential ciphertext may remain in Supabase backup copies");
    expect(calendar?.paragraphs.join(" ")).not.toContain("no more than seven days");
    expect(rows.find(([label]) => label === "Routine logs")).toEqual([
      "Routine logs", "No more than 7 days",
      "Vercel Pro runtime logs: 1 day; Supabase Pro API and database logs: 7 days",
    ]);
    expect(rows.find(([label]) => label === "Deleted-account live data")).toEqual([
      "Deleted-account live data", "Immediately or within 7 days",
      "Auth deletion and database cascades remove live account data immediately when deletion succeeds",
    ]);
    expect(rows.find(([label]) => label === "Google Calendar connector records")?.[2]).toContain("Disconnect deletes the live credential;");
    expect(rows.find(([label]) => label === "Travel place identifiers")?.[2]).toContain("Turning travel off or deleting the account deletes them;");
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
