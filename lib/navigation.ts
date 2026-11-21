export type AppNavHref =
  | "/timeline"
  | "/chat"
  | "/behaviors"
  | "/export"
  | "/settings";

export type ProtectedAppHref = AppNavHref | "/analytics";

export type AppNavItem = {
  href: AppNavHref;
  label: string;
  description: string;
};

export const DEFAULT_APP_ROUTE: AppNavHref = "/timeline";

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    href: "/timeline",
    label: "Timeline",
    description: "Current occurrences and prior unresolved decisions",
  },
  {
    href: "/chat",
    label: "Chat",
    description: "Ask about and change your Cadence records in plain words",
  },
  {
    href: "/behaviors",
    label: "Behaviors",
    description: "Behavior settings, adherence, and dated review",
  },
  {
    href: "/export",
    label: "Export & Import",
    description: "Downloads, BehaviorLog import, and restore previews",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Timezone, notifications, and categories",
  },
];

/**
 * Chat lands in steps (advisor plan, Phase 5). One switch covers web and
 * Cadence for Mac: production web returns 404 for /chat and a release or
 * dev-signed Mac build shows no Chat item until this is true. Development
 * builds of both always show it. The Mac also needs a linked account
 * (Phase 5C): a local-only Mac never shows Chat.
 */
export const CHAT_PAGE_LIVE = true;

export type AppNavSurface = "web" | "desktop";

export function isChatPageAvailable(
  _surface: AppNavSurface,
  production = process.env.NODE_ENV === "production",
) {
  return CHAT_PAGE_LIVE || !production;
}

export function getAppNavItems(
  surface: AppNavSurface,
  production = process.env.NODE_ENV === "production",
): AppNavItem[] {
  return APP_NAV_ITEMS.filter(
    (item) =>
      item.href !== "/chat" || isChatPageAvailable(surface, production),
  );
}

const PROTECTED_APP_ROUTES: ProtectedAppHref[] = [
  ...APP_NAV_ITEMS.map((item) => item.href),
  "/analytics",
];

export function isProtectedAppRoute(pathname: string) {
  return PROTECTED_APP_ROUTES.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
