"use client";

import Link from "next/link";
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
  type LucideIcon,
} from "lucide-react";

import {
  getBrowserPushSupport,
  readBrowserPushSubscriptionStatus,
  readNotificationPermission,
  type BrowserPushSupport,
} from "@/lib/push/browser";
import { resolveFirstRunOnboardingModel } from "@/lib/services/onboarding-model";
import { readTravelRoutingReport, webTravelClient } from "@/lib/ui/travel";
import type {
  FirstRunOnboardingClientSnapshot,
  FirstRunOnboardingItemKey,
  FirstRunOnboardingState,
} from "@/lib/types/onboarding";

const STORAGE_KEY = "cadence-first-run-dismissed";

const itemIcons: Record<FirstRunOnboardingItemKey, LucideIcon> = {
  behavior: ListChecks,
  notifications: Bell,
  timezone: Clock3,
  import: Upload,
  travel: House,
};

type FirstRunOnboardingPanelProps = Readonly<{
  onboarding: FirstRunOnboardingState;
  storageKey?: string;
  /** Asks the deployment whether travel routing is configured. No provider call. */
  readTravelRoutingConfigured?: (signal: AbortSignal) => Promise<boolean>;
}>;

export function FirstRunOnboardingPanel({
  onboarding,
  storageKey = STORAGE_KEY,
  readTravelRoutingConfigured = webTravelClient.configured,
}: FirstRunOnboardingPanelProps) {
  const [clientSnapshot, setClientSnapshot] =
    useState<FirstRunOnboardingClientSnapshot | null>(null);
  const [travelRouting, setTravelRouting] = useState<{
    configured: boolean | null;
  } | null>(null);

  useEffect(() => {
    let isActive = true;
    const timeoutId = window.setTimeout(() => {
      if (!isActive) {
        return;
      }

      void loadClientSnapshot();
    }, 0);

    async function loadClientSnapshot() {
      let dismissed = false;

      try {
        dismissed = window.localStorage.getItem(storageKey) === "true";
      } catch {
        dismissed = false;
      }

      const support = getBrowserPushSupport(onboarding.vapidPublicKey);
      const browserTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      const notificationSubscriptionStatus =
        await inspectFirstRunNotificationSubscriptionStatus(
          support,
          onboarding.vapidPublicKey,
        );

      if (!isActive) {
        return;
      }

      setClientSnapshot({
        dismissed,
        notificationPermission: readNotificationPermission(),
        notificationSupported: support.supported,
        notificationSubscriptionStatus,
        browserTimezone,
        travelRoutingConfigured: null,
      });
    }

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [onboarding.vapidPublicKey, storageKey]);

  // Ask the deployment about routing only while the pop-up will show.
  const checkTravelRouting = Boolean(
    clientSnapshot &&
      onboarding.travel &&
      resolveFirstRunOnboardingModel(onboarding, clientSnapshot).shouldRender,
  );

  useEffect(() => {
    if (!checkTravelRouting) {
      return;
    }

    const controller = new AbortController();
    void readTravelRoutingReport(
      readTravelRoutingConfigured,
      controller.signal,
    ).then((configured) => {
      if (!controller.signal.aborted) {
        setTravelRouting({ configured });
      }
    });

    return () => controller.abort();
  }, [checkTravelRouting, readTravelRoutingConfigured]);

  // Wait for the routing answer so the travel row does not shift the pop-up.
  if (!clientSnapshot || (checkTravelRouting && !travelRouting)) {
    return null;
  }

  const model = resolveFirstRunOnboardingModel(onboarding, {
    ...clientSnapshot,
    travelRoutingConfigured: travelRouting?.configured ?? null,
  });

  if (!model.shouldRender) {
    return null;
  }

  function dismissSetup() {
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      // Local dismissal is a convenience; the app still works without it.
    }

    setClientSnapshot((current) =>
      current ? { ...current, dismissed: true } : current,
    );
  }

  return (
    <section
      role="dialog"
      aria-labelledby="first-run-onboarding-title"
      aria-modal="false"
      className="fixed left-4 right-4 top-[calc(4rem+max(0.75rem,env(safe-area-inset-top)))] z-30 max-h-[calc(100dvh-5.5rem)] overflow-y-auto border border-line bg-background text-foreground sm:left-auto sm:right-6 sm:w-[min(26rem,calc(100vw-2rem))] lg:top-6 lg:max-h-[calc(100dvh-3rem)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-line p-4">
        <div className="min-w-0">
          <h2
            id="first-run-onboarding-title"
            className="text-xl leading-tight"
          >
            Set up Cadence
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-readable">
            Start with one behavior. The other steps use existing Settings and
            Export controls.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss setup"
          title="Dismiss"
          onClick={dismissSetup}
          className="product-icon-action min-h-10 min-w-10 shrink-0"
        >
          <X aria-hidden="true" size={18} strokeWidth={2.5} />
        </button>
      </div>

      <ul className="divide-y divide-line px-4">
        {model.items.map((item) => {
          const Icon = itemIcons[item.key];
          const StateIcon = item.complete ? CheckCircle2 : Circle;

          return (
            <li
              key={item.key}
              className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
                <span className="flex h-6 w-6 items-center justify-center text-muted-readable">
                  <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base leading-6 text-foreground">
                      {item.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm leading-5 text-muted-readable">
                      <StateIcon
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={2}
                      />
                      {item.statusLabel}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-sm leading-6 text-muted-readable">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <Link
                href={item.href}
                className="product-action product-action-primary min-h-10 justify-self-start py-2 text-sm sm:justify-self-end"
              >
                {item.actionLabel}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={dismissSetup}
          className="product-action product-action-secondary min-h-10 py-2 text-sm"
        >
          Skip setup
        </button>
      </div>
    </section>
  );
}

export async function inspectFirstRunNotificationSubscriptionStatus(
  support: BrowserPushSupport,
  vapidPublicKey: string,
  readStatus: typeof readBrowserPushSubscriptionStatus =
    readBrowserPushSubscriptionStatus,
): Promise<
  FirstRunOnboardingClientSnapshot["notificationSubscriptionStatus"]
> {
  if (!support.supported) {
    return "unavailable";
  }

  try {
    return await readStatus(vapidPublicKey);
  } catch {
    return "missing";
  }
}
