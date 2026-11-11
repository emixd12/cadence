import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Download,
  ListChecks,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from "lucide-react";
import { getAccountInitials } from "@/lib/ui/account";
import type { DesktopAccountState } from "./account/auth";
import { APP_NAV_ITEMS } from "@/lib/navigation";
import { getFocusableElements } from "@/components/timeline/NeedsDecisionDialog";

export type DesktopScreen = "timeline" | "behaviors" | "export" | "settings";
export type DesktopAppProps = Readonly<{
  activeScreen: DesktopScreen;
  onNavigate: (screen: DesktopScreen, anchor?: string) => void;
  children: ReactNode;
  availableScreens?: readonly DesktopScreen[];
  conflictCount?: number;
  account?: DesktopAccountState;
}>;
const INITIAL_SCREENS: readonly DesktopScreen[] = ["timeline", "behaviors"];
const ICONS = {
  timeline: CalendarDays,
  behaviors: ListChecks,
  export: Download,
  settings: Settings,
};

export function DesktopApp({
  activeScreen,
  onNavigate,
  children,
  availableScreens = INITIAL_SCREENS,
  conflictCount = 0,
  account = { status: "local" },
}: DesktopAppProps) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return (
        typeof window === "undefined" ||
        window.localStorage.getItem("sidebar-open") !== "false"
      );
    } catch {
      return true;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const originalOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (drawer.current)
        (getFocusableElements(drawer.current)[0] ?? drawer.current).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab" || !drawer.current) return;
      const focusable = getFocusableElements(drawer.current);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        drawer.current.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);

  function navigate(screen: DesktopScreen, anchor?: string) {
    if (!availableScreens.includes(screen)) return;
    setMobileOpen(false);
    onNavigate(screen, anchor);
  }

  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      window.localStorage.setItem("sidebar-open", String(next));
    } catch {
      /* Optional UI preference. */
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 grid h-16 grid-cols-[minmax(0,1fr)_4rem] border-b border-line bg-card lg:hidden">
        <button
          type="button"
          aria-label="Open Timeline"
          onClick={() => navigate("timeline")}
          className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left hover:opacity-70"
        >
          <span className="flex h-16 w-16 items-center justify-center">
            <BrandMark />
          </span>
          <span className="truncate text-lg">Cadence</span>
        </button>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="desktop-mobile-navigation"
          onClick={(event) => { event.currentTarget.focus(); setMobileOpen(true); }}
          className="flex h-16 w-16 items-center justify-center hover:bg-surface"
        >
          <Menu aria-hidden="true" size={16} />
        </button>
      </header>
      <div
        aria-hidden="true"
        onClick={() => setMobileOpen(false)}
        className={[
          "fixed inset-0 z-[70] bg-foreground/25 transition-opacity duration-200 motion-reduce:transition-none lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />
      <aside
        id="desktop-mobile-navigation"
        ref={drawer}
        tabIndex={-1}
        aria-label="Mobile navigation"
        inert={!mobileOpen ? true : undefined}
        className={[
          "fixed left-0 top-0 z-[80] flex h-dvh w-[60vw] max-w-[60vw] flex-col overflow-hidden border-r border-line bg-card transition-transform duration-200 motion-reduce:transition-none lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="grid h-16 grid-cols-[minmax(0,1fr)_3.5rem] items-center">
          <button
            type="button"
            aria-label="Open Timeline"
            onClick={() => navigate("timeline")}
            className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left hover:opacity-70"
          >
            <span className="flex w-16 justify-center">
              <BrandMark />
            </span>
            <span className="truncate text-lg">Cadence</span>
          </button>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="flex h-10 w-10 items-center justify-center hover:bg-surface"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <PrimaryNav
          activeScreen={activeScreen}
          availableScreens={availableScreens}
          onNavigate={navigate}
          collapsed={false}
        />
        <AccountFooter account={account} collapsed={false} onNavigate={() => navigate("settings")} />
      </aside>
      <aside
        aria-label="Desktop navigation"
        className={[
          "fixed inset-y-0 left-0 z-50 hidden flex-col overflow-hidden border-r border-line bg-card transition-[width] duration-200 motion-reduce:transition-none lg:flex",
          sidebarOpen ? "w-64" : "w-16",
        ].join(" ")}
      >
        <div className="relative grid h-16 grid-cols-[4rem_1fr] items-center">
          {sidebarOpen ? (
            <>
              <button
                type="button"
                aria-label="Open Timeline"
                onClick={() => navigate("timeline")}
                className="col-span-2 grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left hover:opacity-70"
              >
                <span className="flex h-16 w-16 items-center justify-center">
                  <BrandMark />
                </span>
                <span className="truncate pr-12 text-lg">Cadence</span>
              </button>
              <button
                type="button"
                aria-label="Collapse navigation"
                onClick={toggleSidebar}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center hover:bg-surface"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Expand navigation"
              onClick={toggleSidebar}
              className="group relative flex h-16 w-16 items-center justify-center"
            >
              <BrandMark className="absolute h-6 w-6 object-contain group-hover:opacity-0" />
              <PanelLeftOpen
                aria-hidden="true"
                size={16}
                className="opacity-0 group-hover:opacity-100"
              />
            </button>
          )}
        </div>
        <PrimaryNav
          activeScreen={activeScreen}
          availableScreens={availableScreens}
          onNavigate={navigate}
          collapsed={!sidebarOpen}
        />
        <AccountFooter account={account} collapsed={!sidebarOpen} onNavigate={() => navigate("settings")} />
      </aside>
      <main
        className={[
          "min-w-0 transition-[padding] duration-200 motion-reduce:transition-none",
          sidebarOpen ? "lg:pl-64" : "lg:pl-16",
        ].join(" ")}
      >
        {/* A fixed 4rem tall cue, so Settings can place its sticky section index below it (Ticket 302). */}
        {conflictCount > 0 ? <div className="sticky top-16 z-20 flex h-16 items-center justify-end border-b border-line bg-background px-2 lg:top-0">
          <button type="button" onClick={() => navigate("settings", "account-conflicts")} className="border border-accent bg-background px-4 py-3 text-sm text-accent focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2">
            Review {conflictCount} sync conflict{conflictCount === 1 ? "" : "s"}
          </button>
        </div> : null}
        {children}
      </main>
    </div>
  );
}

function PrimaryNav({
  activeScreen,
  availableScreens,
  onNavigate,
  collapsed,
}: Readonly<{
  activeScreen: DesktopScreen;
  availableScreens: readonly DesktopScreen[];
  onNavigate: (screen: DesktopScreen) => void;
  collapsed: boolean;
}>) {
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col py-3">
      {APP_NAV_ITEMS.map((item) => {
        const screen = item.href.slice(1) as DesktopScreen;
        const Icon = ICONS[screen];
        const active = activeScreen === screen;
        const available = availableScreens.includes(screen);
        return (
          <button
            key={screen}
            type="button"
            disabled={!available}
            aria-label={available ? item.label : `${item.label} unavailable`}
            title={
              !available
                ? "Local services are not connected yet"
                : collapsed
                  ? item.label
                  : undefined
            }
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(screen)}
            className={[
              "group flex min-h-10 w-full items-center overflow-hidden text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              active && !collapsed
                ? "bg-timeline-row-hover text-foreground"
                : "text-muted-foreground enabled:hover:bg-surface enabled:hover:text-foreground",
            ].join(" ")}
          >
            <span
              className={[
                "flex h-10 w-16 shrink-0 items-center justify-center",
                active ? "bg-timeline-row-hover text-foreground" : "",
              ].join(" ")}
            >
              <Icon aria-hidden="true" size={16} strokeWidth={2} />
            </span>
            <span
              className={
                collapsed
                  ? "pointer-events-none w-0 whitespace-nowrap opacity-0"
                  : "min-w-0 whitespace-nowrap"
              }
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function BrandMark({
  className = "h-6 w-6 object-contain",
}: Readonly<{ className?: string }>) {
  return (
    // Native builds bundle this image without a Next server.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/cadence-logo.png"
      alt=""
      aria-hidden="true"
      width={24}
      height={24}
      className={className}
    />
  );
}

function AccountFooter({ account, collapsed, onNavigate }: Readonly<{
  account: DesktopAccountState;
  collapsed: boolean;
  onNavigate: () => void;
}>) {
  if (account.status !== "linked") return collapsed ? null : (
    <p className="border-t border-line px-4 py-4 text-sm text-muted-readable">Local profile</p>
  );
  const displayName = account.name?.trim() || account.email?.trim() || "Account";
  return <div className="border-t border-line">
    <button type="button" aria-label="Open account settings" title={collapsed ? displayName : undefined} onClick={onNavigate}
      className="group flex h-[60px] w-full items-center overflow-hidden text-left text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className="flex h-[60px] w-16 shrink-0 items-center justify-center">
        <span className="flex h-8 w-8 items-center justify-center border border-line bg-background text-xs text-foreground">
          {getAccountInitials(displayName)}
        </span>
      </span>
      <span className={[
        "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-200",
        collapsed ? "pointer-events-none w-0 opacity-0" : "w-[calc(100%-4rem)] opacity-100",
      ].join(" ")}>
        <span className="block truncate">{displayName}</span>
      </span>
    </button>
  </div>;
}
