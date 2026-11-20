import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { AppShell, SignOutControl } from "../components/layout/AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/timeline",
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("app-shell sign out control", () => {
  it("renders the primary navigation and Timeline brand destinations", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ email: "person@example.test" }}>
        <p>Protected content</p>
      </AppShell>,
    );

    for (const [href, label] of [
      ["/timeline", "Timeline"],
      ["/chat", "Chat"],
      ["/behaviors", "Behaviors"],
      ["/export", "Export &amp; Import"],
      ["/settings", "Settings"],
    ]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`>${label}`);
    }

    expect(html).toContain('aria-label="Open Timeline"');
  });

  it("renders the collapsed desktop header as an expand-only control", () => {
    const html = renderToStaticMarkup(
      <AppShell
        user={{ email: "person@example.test" }}
        defaultDesktopSidebarOpen={false}
      >
        <p>Protected content</p>
      </AppShell>,
    );

    expect(html).toContain('aria-label="Expand navigation"');
    expect(html).toContain('title="Expand navigation"');
    expect(html.match(/aria-label="Open Timeline"/gu)).toHaveLength(2);
    expect(html).not.toContain('title="Open Timeline"');
  });

  it("renders the expanded desktop row directly as a POST form", () => {
    const html = renderToStaticMarkup(
      <SignOutControl isCollapsed={false} />,
    );

    expect(html).toContain('action="/auth/sign-out"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="pushEndpoint"');
    expect(html).toContain(">Sign out</span>");
    expect(html).not.toContain('aria-label="Sign out"');
  });

  it("renders the collapsed desktop cell with an accessible name and tooltip", () => {
    const html = renderToStaticMarkup(
      <SignOutControl isCollapsed />,
    );

    expect(html).toContain('aria-label="Sign out"');
    expect(html).toContain('title="Sign out"');
    expect(html).toContain("pointer-events-none");
  });

  it("renders the mobile-drawer row as the same labeled POST control", () => {
    const html = renderToStaticMarkup(
      <SignOutControl isCollapsed={false} onSubmit={() => undefined} />,
    );

    expect(html).toContain('action="/auth/sign-out"');
    expect(html).toContain('method="post"');
    expect(html).toContain(">Sign out</span>");
  });

  it("places Sign out below the account row in both rendered shell regions", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ email: "person@example.test" }}>
        <p>Protected content</p>
      </AppShell>,
    );

    expect(html.match(/action="\/auth\/sign-out"/gu)).toHaveLength(2);
    expect(
      html.match(
        /aria-label="Open account settings"[\s\S]*?action="\/auth\/sign-out"/gu,
      ),
    ).toHaveLength(2);
  });
});
