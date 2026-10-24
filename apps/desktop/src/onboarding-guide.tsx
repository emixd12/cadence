import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Circle,
  Clock3,
  House,
  ListChecks,
  Upload,
  X,
} from "lucide-react";
import { resolveFirstRunOnboardingModel } from "@/lib/services/onboarding-model";
import type {
  FirstRunOnboardingClientSnapshot,
  FirstRunOnboardingItemKey,
  FirstRunTravelSetup,
} from "@/lib/types/onboarding";
import { readTravelRoutingReport } from "@/lib/ui/travel";
import type { DesktopScreen } from "./desktop-app";
import type {
  NativeNotificationPermission,
  NativeSettingsCoverage,
} from "./settings-screen";

const STORAGE_KEY = "cadence-first-run-dismissed";
const ICONS = {
  behavior: ListChecks,
  notifications: Bell,
  timezone: Clock3,
  import: Upload,
  travel: House,
};
const DESTINATIONS: Record<
  FirstRunOnboardingItemKey,
  { screen: DesktopScreen; anchor: string }
> = {
  behavior: { screen: "behaviors", anchor: "create-behavior" },
  notifications: { screen: "settings", anchor: "notifications" },
  timezone: { screen: "settings", anchor: "timezone" },
  import: { screen: "export", anchor: "behaviorlog-import" },
  travel: { screen: "settings", anchor: "travel" },
};
export type DesktopOnboardingGuideProps = Readonly<{
  hasAnyBehavior: boolean;
  hasImportRuns: boolean;
  currentTimezone: string;
  permission: NativeNotificationPermission;
  coverage: NativeSettingsCoverage | null;
  onNavigate: (screen: DesktopScreen, anchor: string) => void;
  availableScreens: readonly DesktopScreen[];
  /** Reads Home and usual travel presence from the local working copy. */
  loadTravelSetup?: (() => Promise<FirstRunTravelSetup>) | null;
  /** Asks the hosted deployment; null without a linked account, which hides the travel item. */
  readTravelRoutingConfigured?: ((signal: AbortSignal) => Promise<boolean>) | null;
  forceOpen?: boolean;
  onDismiss?: () => void;
}>;

export function DesktopOnboardingGuide({
  hasAnyBehavior,
  hasImportRuns,
  currentTimezone,
  permission,
  coverage,
  onNavigate,
  availableScreens,
  loadTravelSetup = null,
  readTravelRoutingConfigured = null,
  forceOpen = false,
  onDismiss,
}: DesktopOnboardingGuideProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (forceOpen) return false;
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem(STORAGE_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const [deviceTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  );
  const [travel, setTravel] = useState<{
    setup: FirstRunTravelSetup | null;
    configured: boolean | null;
  }>({ setup: null, configured: null });
  const permissionAllowed =
    permission === "authorized" || permission === "provisional";
  // Reuse only the pure checklist model. Native readiness replaces Web Push inspection.
  const client: FirstRunOnboardingClientSnapshot = {
    dismissed,
    browserTimezone: deviceTimezone,
    notificationPermission: permissionAllowed
      ? "granted"
      : permission === "denied"
        ? "denied"
        : permission === "notDetermined"
          ? "default"
          : "unavailable",
    notificationSupported:
      permission === "checking" || permission === "unknown"
        ? null
        : permission !== "unavailable",
    notificationSubscriptionStatus:
      permissionAllowed &&
      coverage?.checkedAt &&
      coverage.status !== "unverified"
        ? "saved"
        : "missing",
    // Unlinking removes the reader; an earlier answer must not keep the row.
    travelRoutingConfigured: readTravelRoutingConfigured ? travel.configured : null,
  };
  const model = resolveFirstRunOnboardingModel(
    {
      hasAnyBehavior,
      hasImportRuns,
      timezone: currentTimezone,
      vapidPublicKey: "",
      travel: travel.setup,
    },
    client,
  );
  const visible = !dismissed && (forceOpen || model.shouldRender);
  const checkTravel = visible && Boolean(loadTravelSetup && readTravelRoutingConfigured);
  useEffect(() => {
    if (!checkTravel || !loadTravelSetup || !readTravelRoutingConfigured) return;
    const controller = new AbortController();
    // Local presence works offline; the travel row also needs the hosted routing report.
    void Promise.all([
      loadTravelSetup().catch(() => null),
      readTravelRoutingReport(readTravelRoutingConfigured, controller.signal),
    ]).then(([setup, configured]) => {
      if (!controller.signal.aborted) setTravel({ setup, configured });
    });
    return () => controller.abort();
  }, [checkTravel, loadTravelSetup, readTravelRoutingConfigured]);
  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* Dismissal still works for this session. */
    }
    setDismissed(true);
    onDismiss?.();
  }

  return (
    <section
      role="dialog"
      aria-labelledby="desktop-setup-title"
      aria-modal="false"
      className="fixed left-4 right-4 top-[calc(4rem+max(0.75rem,env(safe-area-inset-top)))] z-30 max-h-[calc(100dvh-5.5rem)] overflow-y-auto border border-line bg-background text-foreground sm:left-auto sm:right-6 sm:w-[min(26rem,calc(100vw-2rem))] lg:top-6 lg:max-h-[calc(100dvh-3rem)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-line p-4">
        <div>
          <h2 id="desktop-setup-title" className="text-xl leading-tight">
            Set up Cadence
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-readable">
            Start with one behavior. The other steps use existing Settings and
            Export controls.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss setup"
          title="Dismiss"
          onClick={dismiss}
          className="product-icon-action min-h-10 min-w-10 shrink-0"
        >
          <X aria-hidden="true" size={18} strokeWidth={2.5} />
        </button>
      </div>
      <ul className="divide-y divide-line px-4">
        {model.items.map((item) => {
          const Icon = ICONS[item.key];
          const StateIcon = item.complete ? CheckCircle2 : Circle;
          const destination = DESTINATIONS[item.key];
          const available = availableScreens.includes(destination.screen);
          return (
            <li
              key={item.key}
              className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
                <span className="flex h-6 w-6 items-center justify-center text-muted-readable">
                  <Icon aria-hidden="true" size={16} strokeWidth={2} />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base leading-6">
                      {item.key === "notifications"
                        ? "Native notifications"
                        : item.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm leading-5 text-muted-readable">
                      <StateIcon
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={2}
                      />
                      {available ? item.statusLabel : "Unavailable"}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-sm leading-6 text-muted-readable">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                disabled={!available}
                onClick={() =>
                  onNavigate(destination.screen, destination.anchor)
                }
                className="product-action product-action-primary min-h-10 justify-self-start py-2 text-sm sm:justify-self-end"
              >
                {item.actionLabel}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={dismiss}
          className="product-action product-action-secondary min-h-10 py-2 text-sm"
        >
          Skip setup
        </button>
      </div>
    </section>
  );
}
