import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Download,
  ListChecks,
  Menu,
  MessageSquare,
  Settings,
  X,
} from "lucide-react";
import { getAccountInitials } from "@/lib/ui/account";
import type { DesktopAccountState } from "./account/auth";
import { getAppNavItems } from "@/lib/navigation";
import { getFocusableElements } from "@/components/timeline/NeedsDecisionDialog";
import {
  DockableSidebar,
  useDockableSidebar,
} from "@/components/layout/DockableSidebar";
import {
  ChatRecentsList,
  ChatRecentsToggle,
  useChatRecentsOpen,
  type ChatRecentsLinkProps,
  type ChatRecentsLoader,
  type ChatRecentsTarget,
} from "@/components/chat/ChatRecents";

export type DesktopScreen = "timeline" | "chat" | "behaviors" | "export" | "settings";

/**
 * Advisor plan Phase 5C: Chat in the Mac menu. Present only on a linked Mac while
 * Chat is available (`isChatPageAvailable`); a local-only Mac never shows the item.
 */
export type DesktopChatNav = Readonly<{
  load: ChatRecentsLoader;
  /** A recent chat or "All conversations" in the menu. */
  onOpen: (target: ChatRecentsTarget) => void;
  /** The conversation on the Chat screen, marked in the menu. */
  activeId: string | null;
}>;
export type DesktopAppProps = Readonly<{
  activeScreen: DesktopScreen;
  onNavigate: (screen: DesktopScreen, anchor?: string) => void;
  children: ReactNode;
  availableScreens?: readonly DesktopScreen[];
  conflictCount?: number;
  account?: DesktopAccountState;
  chat?: DesktopChatNav | null;
}>;
const INITIAL_SCREENS: readonly DesktopScreen[] = ["timeline", "behaviors"];
const ICONS = {
  timeline: CalendarDays,
  chat: MessageSquare,
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
  chat = null,
}: DesktopAppProps) {
  const sidebar = useDockableSidebar({
    defaultPreference: "docked",
    readInitialPreferenceSync: true,
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
    sidebar.dismissOverlay();
    onNavigate(screen, anchor);
  }

  function openChat(target: ChatRecentsTarget) {
    setMobileOpen(false);
    sidebar.dismissOverlay();
    chat?.onOpen(target);
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
          chat={chat}
          onOpenChat={openChat}
        />
        <AccountFooter account={account} collapsed={false} onNavigate={() => navigate("settings")} />
      </aside>
      <DockableSidebar
        controller={sidebar}
        ariaLabel="Desktop navigation"
        brandMark={<BrandMark />}
        renderBrandLink={(state) =>
          state.isDocked ? (
            <button
              type="button"
              aria-label="Open Timeline"
              onClick={() => navigate("timeline")}
              className="col-span-2 grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex h-16 w-16 items-center justify-center">
                <BrandMark />
              </span>
              <span className="truncate pr-12 text-lg">Cadence</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label="Open Timeline"
              onClick={() => navigate("timeline")}
              className="flex h-16 min-w-0 items-center pr-3 text-left transition-opacity duration-150 ease-out hover:opacity-70 active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="truncate text-lg">Cadence</span>
            </button>
          )
        }
        renderNav={(state) => (
          <PrimaryNav
            activeScreen={activeScreen}
            availableScreens={availableScreens}
            onNavigate={navigate}
            collapsed={state.isCollapsed}
            chat={chat}
            onOpenChat={openChat}
          />
        )}
        renderFooter={(state) => (
          <AccountFooter
            account={account}
            collapsed={state.isCollapsed}
            onNavigate={() => navigate("settings")}
          />
        )}
      />
      <main
        data-sidebar-layout={sidebar.isDocked ? "docked" : "collapsed"}
        className={[
          "min-w-0 transition-[padding] duration-[180ms] ease-out motion-reduce:transition-none",
          sidebar.isDocked ? "lg:pl-64" : "lg:pl-16",
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
  chat,
  onOpenChat,
}: Readonly<{
  activeScreen: DesktopScreen;
  availableScreens: readonly DesktopScreen[];
  onNavigate: (screen: DesktopScreen) => void;
  collapsed: boolean;
  chat: DesktopChatNav | null;
  onOpenChat: (target: ChatRecentsTarget) => void;
}>) {
  const [recentsOpen, toggleRecents] = useChatRecentsOpen();
  // Development builds always show Chat; release and dev-signed builds follow CHAT_PAGE_LIVE.
  const items = getAppNavItems("desktop", !import.meta.env.DEV).filter((item) => item.href !== "/chat" || chat);
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col overflow-y-auto py-3">
      {items.map((item) => {
        const screen = item.href.slice(1) as DesktopScreen;
        const Icon = ICONS[screen];
        const active = activeScreen === screen;
        const available = availableScreens.includes(screen);
        // Chat carries a small arrow that opens its recent chats underneath (as on web).
        const supportsRecents = screen === "chat" && Boolean(chat) && available;
        const withRecents = supportsRecents && !collapsed;
        const button = (
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
              "group flex min-h-10 items-center overflow-hidden text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              withRecents ? "min-w-0 flex-1" : "w-full",
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
              className={[
                "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-[180ms] ease-out motion-reduce:transition-none",
                collapsed
                  ? "pointer-events-none w-0 opacity-0"
                  : "w-[calc(100%-4rem)] opacity-100",
              ].join(" ")}
            >
              {item.label}
            </span>
          </button>
        );
        if (!supportsRecents || !chat) return button;
        return (
          <div key={screen} data-nav-chat>
            <div className={["flex items-center", active && !collapsed ? "bg-timeline-row-hover" : ""].join(" ")}>
              {button}
              {withRecents ? (
                <ChatRecentsToggle open={recentsOpen} onToggle={toggleRecents} />
              ) : null}
            </div>
            {withRecents && recentsOpen ? <DesktopChatRecents chat={chat} active={active} onOpen={onOpenChat} /> : null}
          </div>
        );
      })}
    </nav>
  );
}

function DesktopChatRecents({
  chat,
  active,
  onOpen,
}: Readonly<{ chat: DesktopChatNav; active: boolean; onOpen: (target: ChatRecentsTarget) => void }>) {
  const activeId = active ? chat.activeId : null;
  const renderLink = useCallback(
    ({ target, className, title, current, children }: ChatRecentsLinkProps) => (
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        title={title}
        onClick={() => onOpen(target)}
        data-chat-recent={target.kind === "conversation" ? target.id : undefined}
        className={className}
      >
        {children}
      </button>
    ),
    [onOpen],
  );
  return <ChatRecentsList load={chat.load} renderLink={renderLink} activeId={activeId} refreshKey={activeId ?? ""} />;
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
        "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-[180ms] ease-out motion-reduce:transition-none",
        collapsed ? "pointer-events-none w-0 opacity-0" : "w-[calc(100%-4rem)] opacity-100",
      ].join(" ")}>
        <span className="block truncate">{displayName}</span>
      </span>
    </button>
  </div>;
}
