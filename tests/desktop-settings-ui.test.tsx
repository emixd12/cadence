import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SettingsScreen,
  type NativeSettingsCoverage,
  type SettingsScreenProps,
} from "../apps/desktop/src/settings-screen";
import { DesktopOnboardingGuide } from "../apps/desktop/src/onboarding-guide";
import { LocalDatabaseSection } from "../apps/desktop/src/local-database-controls";
import { ConnectorLibrary, ConnectorUnavailable, connectorUnavailableReason } from "@/components/settings/ConnectorLibrary";

const complete: NativeSettingsCoverage = {
  status: "complete",
  scheduledThrough: "2026-09-29T15:00:00Z",
  targetThrough: "2026-09-29T15:00:00Z",
  checkedAt: "2026-08-30T15:00:00Z",
  firstUnscheduledAt: null,
  expectedCount: 120,
  scheduledCount: 120,
  missingIds: [],
};

function settings(overrides: Partial<SettingsScreenProps> = {}) {
  const props: SettingsScreenProps = {
    currentTimezone: "America/New_York",
    accountConnected: false,
    updateTimezoneAction: async (state) => state,
    permission: "authorized",
    coverage: complete,
    busy: false,
    onRequestPermission: vi.fn(),
    onReconcile: vi.fn(),
    onShowOnboarding: vi.fn(),
    ...overrides,
  };
  return { props, html: renderToStaticMarkup(<SettingsScreen {...props} />) };
}

describe("native Settings coverage", () => {
  it("shows actual verified counts and through dates without capping them", () => {
    const { props, html } = settings();
    expect(html).toContain(
      "All eligible reminders in the target window are scheduled.",
    );
    expect(html).toContain("2026-09-29T15:00:00Z");
    expect(html).toContain("2026-08-30T15:00:00Z");
    expect(html.match(/>120<\/dd>/g)).toHaveLength(2);
    expect(html).toContain("Save timezone");
    expect(html).toContain("Show setup guide");
    expect(props.onRequestPermission).not.toHaveBeenCalled();
    expect(props.onReconcile).not.toHaveBeenCalled();
  });

  it("shows the shorter contiguous horizon separately from later retained requests", () => {
    const { html } = settings({
      coverage: {
        ...complete,
        status: "limited",
        scheduledThrough: "2026-09-01T15:00:00Z",
        firstUnscheduledAt: "2026-09-02T15:00:00Z",
        scheduledCount: 73,
        missingIds: ["gap"],
      },
    });
    expect(html).toContain("Limited reminder coverage.");
    expect(html).toContain("2026-09-01T15:00:00Z");
    expect(html).toContain("2026-09-02T15:00:00Z");
    expect(html).toContain("2026-09-29T15:00:00Z");
    expect(html).toContain(">73</dd>");
    expect(html).not.toContain(
      "All eligible reminders in the target window are scheduled.",
    );
  });

  it.each([
    { coverage: null },
    { coverage: { ...complete, status: "unverified" as const } },
    { coverage: { ...complete, checkedAt: null } },
    { permission: "denied" as const },
    { permission: "unknown" as const },
    { error: "macOS readback failed" },
  ])("does not present stale or unknown data as verified: %j", (overrides) => {
    const { html } = settings(overrides);
    expect(html).toContain("Reminder coverage is not verified.");
    expect(html).toMatch(/Verified through<\/dt><dd[^>]*>Not verified<\/dd>/);
    expect(html).toMatch(/Retained reminders<\/dt><dd[^>]*>Not verified<\/dd>/);
  });

  it("requests permission only when macOS has not recorded a decision", () => {
    expect(
      settings({ permission: "notDetermined", coverage: null }).html,
    ).toContain("Request notification permission");
    const denied = settings({ permission: "denied" }).html;
    expect(denied).not.toContain("Request notification permission");
    expect(denied).toContain("macOS System Settings");
    expect(denied).toContain("Refresh reminder coverage");
    expect(settings({ busy: true }).html).toContain('disabled=""');
  });

  it("describes SQLite as an offline working copy only in account mode", () => {
    expect(settings({ accountConnected: true }).html).toContain("offline working copy");
    expect(settings({ accountConnected: true }).html).toContain("Account changes synchronize");
    expect(settings({ accountConnected: false }).html).toContain("No cloud account");
  });
});

describe("native setup guide", () => {
  it("keeps current task intents and leaves unavailable import disabled", () => {
    const onNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <DesktopOnboardingGuide
        hasAnyBehavior={false}
        hasImportRuns={false}
        currentTimezone="America/New_York"
        permission="denied"
        coverage={null}
        availableScreens={["timeline", "behaviors", "settings"]}
        onNavigate={onNavigate}
        forceOpen
      />,
    );
    expect(html).toContain("Native notifications");
    expect(html).not.toContain("Browser notifications");
    expect(html).toContain("Blocked");
    expect(html).toContain("Create behavior");
    expect(html).toContain("Review timezone");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open import<\/button>/);
    expect(html).toContain("Dismiss setup");
    expect(html).toContain("Skip setup");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("local database controls", () => {
  it("discloses the exact path and protects local restore", () => {
    const html = renderToStaticMarkup(<LocalDatabaseSection
      info={{ path: "/Users/test/Library/Application Support/app.cadence.desktop/cadence.sqlite3", localMode: true }}
      confirmation="" busy={false} message="" onConfirmationChange={vi.fn()} onReveal={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} />);
    expect(html).toContain("/Users/test/Library/Application Support/app.cadence.desktop/cadence.sqlite3");
    expect(html).toContain("Reveal in Finder");
    expect(html).toContain("Back Up");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Restore local database/);
    expect(html).toContain("protects the current database");
  });

  it("reports recovery totals and requires acknowledgement before deleting its backup", () => {
    const usage = { databaseBytes: 100, walBytes: 20, shmBytes: 10, recoveryBytes: 1000, totalBytes: 1130 };
    const html = renderToStaticMarkup(<LocalDatabaseSection
      info={{ path: "/Application Support/cadence.sqlite3", localMode: false,
        recovery: { state: "reopen_verified", backupPath: "/Application Support/Backups/recovery.sqlite3", before: usage, after: usage } }}
      confirmation="" busy={false} message="" onConfirmationChange={vi.fn()} onReveal={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} onDeleteRecoveryBackup={vi.fn()} />);
    expect(html).toContain("Current storage, including remaining recovery files");
    expect(html).toContain("Permanently delete this recovery backup");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete recovery backup/);
  });

  it("does not claim an unfinished recovery deleted its backup", () => {
    const usage = { databaseBytes: 100, walBytes: 0, shmBytes: 0, recoveryBytes: 100, totalBytes: 200 };
    const html = renderToStaticMarkup(<LocalDatabaseSection
      info={{ path: "/Application Support/cadence.sqlite3", localMode: false,
        recovery: { state: "backup_pending", backupPath: null, before: usage, after: usage } }}
      confirmation="" busy={false} message="" onConfirmationChange={vi.fn()} onReveal={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} />);
    expect(html).toContain("Storage recovery has not finished.");
    expect(html).not.toContain("backup was deleted");
    expect(html).not.toContain("Delete recovery backup");
  });

  it("hides raw restore outside local mode", () => {
    const html = renderToStaticMarkup(<LocalDatabaseSection
      info={{ path: "/Application Support/cadence.sqlite3", localMode: false }} confirmation="RESTORE"
      busy={false} message="" onConfirmationChange={vi.fn()} onReveal={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} />);
    expect(html).toContain("Disconnect the account before restoring");
    expect(html).not.toContain("Restore local database");
  });
});

describe("desktop connector library (Ticket 225)", () => {
  it("shows every source as requiring a linked account in local mode without connect controls", () => {
    const { html } = settings({ calendarControls: <ConnectorLibrary sources={[
      { id: "google_calendar", content: <ConnectorUnavailable id="google_calendar" reason="Calendar requires a linked account." /> },
      { id: "outlook_calendar", content: <ConnectorUnavailable id="outlook_calendar" reason={connectorUnavailableReason("Outlook Calendar", "local")} /> },
      { id: "icloud_calendar" },
      { id: "hevy", content: <ConnectorUnavailable id="hevy" reason={connectorUnavailableReason("Hevy", "local")} /> },
    ]} /> });
    expect(html).toContain("Connected sources");
    expect(html).toContain("Link a Cadence account on this Mac to connect Outlook Calendar.");
    expect(html).toContain("Link a Cadence account on this Mac to connect Hevy.");
    expect(html).toContain("Not available yet. Cadence cannot connect iCloud Calendar in this version.");
    expect(html).toContain("Recorded activity.");
    expect(html).not.toMatch(/<input[^>]*type="password"/);
    expect(html).not.toContain("Connect Outlook Calendar");
  });
});
