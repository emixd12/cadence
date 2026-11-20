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
 * Chat lands in steps (advisor plan, Phase 5). The page stays out of
 * production web until the chat server is on main; the final 5B change sets
 * this to true. Cadence for Mac hides Chat until Phase 5C adds its screen.
 */
export const CHAT_PAGE_LIVE_ON_WEB = false;

export type AppNavSurface = "web" | "desktop";

export function isChatPageAvailable(
  surface: AppNavSurface,
  production = process.env.NODE_ENV === "production",
) {
  if (surface === "desktop") return false;
  return CHAT_PAGE_LIVE_ON_WEB || !production;
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
