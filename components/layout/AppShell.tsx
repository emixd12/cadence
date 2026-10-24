"use client";

import Link from "next/link";
import { getAccountInitials } from "@/lib/ui/account";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Download,
  ListChecks,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  APP_NAV_ITEMS,
  DEFAULT_APP_ROUTE,
  type AppNavHref,
} from "@/lib/navigation";
import { readCurrentBrowserPushEndpoint } from "@/lib/push/browser";
import { WebRuntimeProvider } from "@/components/layout/WebRuntimeProvider";
import { PlaceLabelProvider } from "@/components/travel/PlaceLabels";

const navIcons: Record<AppNavHref, LucideIcon> = {
  "/timeline": CalendarDays,
  "/behaviors": ListChecks,
  "/export": Download,
  "/settings": Settings,
};

const SIDEBAR_STORAGE_KEY = "sidebar-open";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const EDGE_SWIPE_WIDTH = 20;
const SWIPE_THRESHOLD = 48;
const SHOW_LOGIN_PREVIEW_LINK = process.env.NODE_ENV !== "production";
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type AppShellUser = {
  name?: string | null;
  email?: string | null;
};

type TouchGesture = {
  x: number;
  y: number;
  mode: "open" | "close";
};

function BrandMark({ className = "h-6 w-6" }: Readonly<{ className?: string }>) {
  return (
    <Image
      src="/brand/cadence-logo.png"
      alt=""
      aria-hidden="true"
      width={24}
      height={24}
      sizes="24px"
      className={["shrink-0 object-contain", className].join(" ")}
    />
  );
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"),
  );
}

function PrimaryNav({
  pathname,
  pendingHref,
  isCollapsed,
  onNavigate,
}: Readonly<{
  pathname: string;
  pendingHref?: AppNavHref | null;
  isCollapsed: boolean;
  onNavigate?: (href: AppNavHref) => void;
}>) {
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col py-3">
      {APP_NAV_ITEMS.map((item) => {
        const Icon = navIcons[item.href];
        const isActive = pathname === item.href;
        const isPending = pendingHref === item.href && !isActive;

        return (
          <Link
            key={item.href}
            href={item.href}
            title={isCollapsed ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            aria-busy={isPending ? true : undefined}
            onClick={() => onNavigate?.(item.href)}
            className={[
              "group flex h-10 w-full items-center overflow-hidden text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              isCollapsed
                ? isPending
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground"
                : isActive
                  ? "bg-timeline-row-hover text-foreground"
                  : isPending
                    ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
            ].join(" ")}
          >
            <span
              className={[
                "flex h-10 w-16 shrink-0 items-center justify-center transition-colors",
                isCollapsed
                  ? isActive
                    ? "bg-timeline-row-hover text-foreground"
                    : isPending
                      ? "bg-surface text-foreground"
                    : "group-hover:bg-surface group-hover:text-foreground"
                  : "",
              ].join(" ")}
            >
              <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            </span>
            <span
              className={[
                "relative min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-200",
                isCollapsed
                  ? "w-0 opacity-0 pointer-events-none"
                  : "w-[calc(100%-4rem)] opacity-100",
              ].join(" ")}
            >
              {item.label}
              {isPending ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 h-px w-8 bg-foreground"
                />
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

const MOBILE_HEADER_BORDER_FADE_DISTANCE = 48;

function AccountTrigger({
  displayName,
  isCollapsed,
  onNavigate,
}: Readonly<{
  displayName: string;
  isCollapsed: boolean;
  onNavigate?: () => void;
}>) {
  return (
    <Link
      href="/settings"
      title={isCollapsed ? displayName : undefined}
      aria-label="Open account settings"
      onClick={onNavigate}
      className={[
        "group flex h-[60px] w-full items-center overflow-hidden text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isCollapsed
          ? "text-muted-foreground"
          : "text-muted-foreground hover:bg-surface hover:text-foreground",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-[60px] w-16 shrink-0 items-center justify-center transition-colors",
          isCollapsed ? "group-hover:bg-surface group-hover:text-foreground" : "",
        ].join(" ")}
      >
        <span className="flex h-8 w-8 items-center justify-center border border-line bg-background text-xs text-foreground">
          {getAccountInitials(displayName)}
        </span>
      </span>
      <span
        className={[
          "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-200",
          isCollapsed
            ? "w-0 opacity-0 pointer-events-none"
            : "w-[calc(100%-4rem)] opacity-100",
        ].join(" ")}
      >
        <span className="block truncate">{displayName}</span>
      </span>
    </Link>
  );
}

function LoginPreviewLink({
  href,
  isCollapsed,
  onNavigate,
}: Readonly<{
  href: string;
  isCollapsed: boolean;
  onNavigate?: () => void;
}>) {
  return (
    <Link
      href={href}
      title={isCollapsed ? "Preview login" : undefined}
      aria-label="Preview login screen"
      onClick={onNavigate}
      className={[
        "group flex h-10 w-full items-center overflow-hidden text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isCollapsed
          ? "text-muted-foreground"
          : "text-muted-foreground hover:bg-surface hover:text-foreground",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-16 shrink-0 items-center justify-center transition-colors",
          isCollapsed ? "group-hover:bg-surface group-hover:text-foreground" : "",
        ].join(" ")}
      >
        <LogIn aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      </span>
      <span
        className={[
          "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-200",
          isCollapsed
            ? "w-0 opacity-0 pointer-events-none"
            : "w-[calc(100%-4rem)] opacity-100",
        ].join(" ")}
      >
        <span className="block truncate">Preview login</span>
      </span>
    </Link>
  );
}

export function SignOutControl({
  isCollapsed,
  onSubmit,
}: Readonly<{
  isCollapsed: boolean;
  onSubmit?: () => void;
}>) {
  const submittingRef = useRef(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (submittingRef.current) {
        return;
      }

      submittingRef.current = true;
      const form = event.currentTarget;
      const endpointInput = form.elements.namedItem("pushEndpoint");

      if (endpointInput instanceof HTMLInputElement) {
        endpointInput.value = (await readCurrentBrowserPushEndpoint()) ?? "";
      }

      onSubmit?.();
      form.submit();
    },
    [onSubmit],
  );

  return (
    <form action="/auth/sign-out" method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="pushEndpoint" defaultValue="" />
      <button
        type="submit"
        title={isCollapsed ? "Sign out" : undefined}
        aria-label={isCollapsed ? "Sign out" : undefined}
        className={[
          "group flex h-10 w-full items-center overflow-hidden text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isCollapsed
            ? "text-muted-foreground"
            : "text-muted-foreground hover:bg-surface hover:text-foreground",
        ].join(" ")}
      >
        <span
          className={[
            "flex h-10 w-16 shrink-0 items-center justify-center transition-colors",
            isCollapsed
              ? "group-hover:bg-surface group-hover:text-foreground"
              : "",
          ].join(" ")}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        </span>
        <span
          className={[
            "min-w-0 overflow-hidden whitespace-nowrap text-left transition-opacity duration-200",
            isCollapsed
              ? "w-0 opacity-0 pointer-events-none"
              : "w-[calc(100%-4rem)] opacity-100",
          ].join(" ")}
        >
          Sign out
        </span>
      </button>
    </form>
  );
}

export function AppShell({
  children,
  user,
  defaultDesktopSidebarOpen = true,
}: Readonly<{
  children: React.ReactNode;
  user?: AppShellUser;
  defaultDesktopSidebarOpen?: boolean;
}>) {
  const pathname = usePathname();
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(
    defaultDesktopSidebarOpen,
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mobileHeaderBorderOpacity, setMobileHeaderBorderOpacity] = useState(0);
  const [pendingHref, setPendingHref] = useState<AppNavHref | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const hasStoredSidebarPreferenceRef = useRef(false);
  const touchGestureRef = useRef<TouchGesture | null>(null);

  const displayName = user?.name?.trim() || user?.email?.trim() || "Account";
  const loginPreviewHref = `/login?preview=1&next=${encodeURIComponent(pathname)}`;

  const closeMobileNav = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  const handlePrimaryNavNavigate = useCallback(
    (href: AppNavHref) => {
      if (href !== pathname) {
        setPendingHref(href);
      }

      closeMobileNav();
    },
    [closeMobileNav, pathname],
  );

  const handleMobileBrandNavigate = useCallback(() => {
    if (DEFAULT_APP_ROUTE !== pathname) {
      setPendingHref(DEFAULT_APP_ROUTE);
    }

    closeMobileNav();
  }, [closeMobileNav, pathname]);

  const handleDesktopBrandNavigate = useCallback(() => {
    if (DEFAULT_APP_ROUTE !== pathname) {
      setPendingHref(DEFAULT_APP_ROUTE);
    }
  }, [pathname]);

  const toggleDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarOpen((current) => {
      const nextValue = !current;
      hasStoredSidebarPreferenceRef.current = true;

      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
      } catch {
        // Persistence is a convenience; the sidebar still works without it.
      }

      return nextValue;
    });
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    let storedValue: string | null = null;

    try {
      storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    } catch {
      storedValue = null;
    }

    const handleDesktopChange = (event: MediaQueryListEvent) => {
      if (!hasStoredSidebarPreferenceRef.current) {
        setIsDesktopSidebarOpen(event.matches);
      }
    };

    const frameId = window.requestAnimationFrame(() => {
      if (storedValue === "true" || storedValue === "false") {
        hasStoredSidebarPreferenceRef.current = true;
        setIsDesktopSidebarOpen(storedValue === "true");
      } else {
        setIsDesktopSidebarOpen(mediaQuery.matches);
      }
    });

    mediaQuery.addEventListener("change", handleDesktopChange);

    return () => {
      window.cancelAnimationFrame(frameId);
      mediaQuery.removeEventListener("change", handleDesktopChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMobileOpen]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const previousElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    window.requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer) {
        return;
      }

      const [firstFocusable] = getFocusableElements(drawer);
      (firstFocusable ?? drawer).focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileNav();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const drawer = drawerRef.current;
      if (!drawer) {
        return;
      }

      const focusableElements = getFocusableElements(drawer);

      if (focusableElements.length === 0) {
        event.preventDefault();
        drawer.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!drawer.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousElement?.focus({ preventScroll: true });
    };
  }, [closeMobileNav, isMobileOpen]);

  useEffect(() => {
    let frameId: number | null = null;

    const updateBorderOpacity = () => {
      frameId = null;

      const scrollPosition =
        window.scrollY || document.documentElement.scrollTop || 0;
      const nextOpacity = Math.min(
        scrollPosition / MOBILE_HEADER_BORDER_FADE_DISTANCE,
        1,
      );

      setMobileHeaderBorderOpacity((currentOpacity) =>
        Math.abs(currentOpacity - nextOpacity) < 0.01
          ? currentOpacity
          : nextOpacity,
      );
    };

    const scheduleUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateBorderOpacity);
    };

    updateBorderOpacity();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth >= 1024 || event.touches.length !== 1) {
        touchGestureRef.current = null;
        return;
      }

      const touch = event.touches[0];

      if (isMobileOpen) {
        touchGestureRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          mode: "close",
        };
        return;
      }

      touchGestureRef.current =
        touch.clientX <= EDGE_SWIPE_WIDTH
          ? {
              x: touch.clientX,
              y: touch.clientY,
              mode: "open",
            }
          : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      const touch = event.touches[0];

      if (!gesture || !touch) {
        return;
      }

      const deltaX = touch.clientX - gesture.x;
      const deltaY = touch.clientY - gesture.y;
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

      if (!isHorizontalSwipe || Math.abs(deltaX) < SWIPE_THRESHOLD) {
        return;
      }

      if (gesture.mode === "open" && deltaX > 0) {
        setIsMobileOpen(true);
        touchGestureRef.current = null;
      }

      if (gesture.mode === "close" && deltaX < 0) {
        closeMobileNav();
        touchGestureRef.current = null;
      }
    };

    const handleTouchEnd = () => {
      touchGestureRef.current = null;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [closeMobileNav, isMobileOpen]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 grid h-16 grid-cols-[minmax(0,1fr)_4rem] bg-card lg:hidden">
        <Link
          href={DEFAULT_APP_ROUTE}
          aria-label="Open Timeline"
          onClick={handleMobileBrandNavigate}
          className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex h-16 w-16 items-center justify-center">
            <BrandMark />
          </span>
          <span className="truncate text-lg">Cadence</span>
        </Link>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={isMobileOpen}
          aria-controls="mobile-navigation"
          onClick={(event) => { event.currentTarget.focus(); setIsMobileOpen(true); }}
          className="flex h-16 w-16 items-center justify-center transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Menu aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        </button>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line transition-opacity duration-150 ease-out motion-reduce:transition-none"
          style={{ opacity: mobileHeaderBorderOpacity }}
        />
      </header>

      <div>
        <div
          aria-hidden="true"
          onClick={closeMobileNav}
          className={[
            "fixed inset-0 z-[70] bg-foreground/25 transition-opacity duration-200 ease-out motion-reduce:transition-none lg:hidden",
            isMobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
        />

        <aside
          id="mobile-navigation"
          ref={drawerRef}
          tabIndex={-1}
          aria-label="Mobile navigation"
          inert={!isMobileOpen ? true : undefined}
          className={[
            "fixed left-0 top-0 z-[80] flex h-screen w-[60vw] max-w-[60vw] flex-col overflow-hidden border-r border-line bg-card shadow-lg transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden",
            isMobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="relative grid h-16 grid-cols-[minmax(0,1fr)_3.5rem] items-center">
            <Link
              href={DEFAULT_APP_ROUTE}
              aria-label="Open Timeline"
              onClick={handleMobileBrandNavigate}
              className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex h-16 w-16 items-center justify-center">
                <BrandMark />
              </span>
              <span className="min-w-0 truncate pr-3 text-lg">Cadence</span>
            </Link>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={closeMobileNav}
              className="flex h-10 w-10 items-center justify-center justify-self-center transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <PrimaryNav
            pathname={pathname}
            pendingHref={pendingHref}
            isCollapsed={false}
            onNavigate={handlePrimaryNavNavigate}
          />

          <div className="border-t border-line">
            {SHOW_LOGIN_PREVIEW_LINK ? (
              <LoginPreviewLink
                href={loginPreviewHref}
                isCollapsed={false}
                onNavigate={closeMobileNav}
              />
            ) : null}
            <AccountTrigger
              displayName={displayName}
              isCollapsed={false}
              onNavigate={closeMobileNav}
            />
            <SignOutControl
              isCollapsed={false}
              onSubmit={closeMobileNav}
            />
          </div>
        </aside>

        <aside
          className={[
            "fixed inset-y-0 left-0 z-50 hidden flex-col overflow-hidden border-r border-line bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
            isDesktopSidebarOpen ? "w-64" : "w-16",
          ].join(" ")}
        >
          <div className="relative grid h-16 grid-cols-[4rem_1fr] items-center">
            {isDesktopSidebarOpen ? (
              <Link
                href={DEFAULT_APP_ROUTE}
                aria-label="Open Timeline"
                onClick={handleDesktopBrandNavigate}
                className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex h-16 w-16 items-center justify-center">
                  <BrandMark />
                </span>
                <span className="min-w-0 pr-12">
                  <span className="block truncate text-lg">Cadence</span>
                </span>
              </Link>
            ) : (
              <button
                type="button"
                title="Expand navigation"
                aria-label="Expand navigation"
                onClick={toggleDesktopSidebar}
                className="group relative flex h-16 w-16 items-center justify-center transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <BrandMark className="absolute h-6 w-6 transition-opacity duration-200 group-hover:opacity-0 motion-reduce:transition-none" />
                <PanelLeftOpen
                  aria-hidden="true"
                  className="absolute h-4 w-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
                  strokeWidth={2}
                />
              </button>
            )}
            {isDesktopSidebarOpen ? (
              <button
                type="button"
                aria-label="Collapse navigation"
                onClick={toggleDesktopSidebar}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <PanelLeftClose
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={2}
                />
              </button>
            ) : null}
          </div>

          <PrimaryNav
            pathname={pathname}
            pendingHref={pendingHref}
            isCollapsed={!isDesktopSidebarOpen}
            onNavigate={handlePrimaryNavNavigate}
          />

          <div className="border-t border-line">
            {SHOW_LOGIN_PREVIEW_LINK ? (
              <LoginPreviewLink
                href={loginPreviewHref}
                isCollapsed={!isDesktopSidebarOpen}
              />
            ) : null}
            <AccountTrigger
              displayName={displayName}
              isCollapsed={!isDesktopSidebarOpen}
            />
            <SignOutControl isCollapsed={!isDesktopSidebarOpen} />
          </div>
        </aside>

        <main
          className={[
            "min-w-0 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            isDesktopSidebarOpen ? "lg:pl-64" : "lg:pl-16",
          ].join(" ")}
        >
          <WebRuntimeProvider><PlaceLabelProvider>{children}</PlaceLabelProvider></WebRuntimeProvider>
        </main>
      </div>
    </div>
  );
}
