// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import type { NoteShortcut, NoteShortcutView } from "@cadence/core/types/note-shortcut";
import {
  DayNoteShortcutSettings,
  type NoteShortcutAction,
} from "../components/note-shortcuts/NoteShortcutControls";
import { SettingsDrawer, SettingsGroup, SettingsSections } from "../components/settings/SettingsSections";
import { DAY_NOTE_SHORTCUTS_PURPOSE, dayNoteShortcutsSectionState } from "../lib/ui/settings-sections";
import { DayNoteControl } from "../components/timeline/DayNoteControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const shortcut = (text: string, status: NoteShortcut["status"] = "accepted"): NoteShortcut => ({
  key: (status === "accepted" ? "a" : "b").repeat(64), text, status, source: "repeated_text",
  evidence: [], created_at: "2026-11-10T00:00:00Z", expires_at: status === "accepted" ? null : "2026-12-10T00:00:00Z",
});
const view = (overrides: Partial<NoteShortcutView> = {}): NoteShortcutView => ({
  state: {
    id: DAY_NOTE_SHORTCUT_POOL_ID, user_id: "10000000-0000-4000-8000-000000000001", behavior_id: null, enabled: true,
    entries: [shortcut("Travel day"), shortcut("Rest day", "proposed")], excluded_occurrence_ids: [], revision: 1, updated_at: "2026-11-10T00:00:00Z",
  },
  globalEnabled: true,
  available: true,
  entries: [shortcut("Travel day"), shortcut("Rest day", "proposed")],
  ...overrides,
});
const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === label);

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, unmount: () => act(async () => root.unmount()) };
}

describe("Day note shortcuts in Settings", () => {
  it("sits in a General drawer, shows no switch, and manages only the day-note pool", async () => {
    const calls: Array<string | null> = [];
    const action: NoteShortcutAction = async (poolId) => {
      calls.push(poolId);
      return { status: "success", message: "Note shortcut accepted." };
    };
    const { container, unmount } = await render(
      <SettingsSections>
        <SettingsGroup id="settings-general">
          <SettingsDrawer title="Day note shortcuts" description={DAY_NOTE_SHORTCUTS_PURPOSE} label="Day note shortcuts"
            state={dayNoteShortcutsSectionState(view())}>
            <DayNoteShortcutSettings view={view()} action={action} />
          </SettingsDrawer>
        </SettingsGroup>
      </SettingsSections>,
    );
    try {
      const drawer = container.querySelector("#settings-general [data-settings-drawer]")!;
      // The drawer owns the title, so the panel adds no second heading.
      expect([...drawer.querySelectorAll("h2,h3,h4,h5")].filter((heading) => heading.textContent === "Day note shortcuts")).toHaveLength(1);
      expect(drawer.textContent).toContain("On · 1 suggested · 1 accepted");
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
      expect(button(container, "Find repeated day notes")).toBeUndefined();
      expect(container.textContent).toContain("Rest day");
      expect(container.textContent).toContain("Travel day");
      await act(async () => button(container, "Accept")!.click());
      expect(calls).toEqual([DAY_NOTE_SHORTCUT_POOL_ID]);
    } finally {
      await unmount();
    }
  });

  it("explains an empty pool", async () => {
    const action: NoteShortcutAction = async () => ({ status: "idle", message: "" });
    const { container, unmount } = await render(<DayNoteShortcutSettings view={view({ state: null, entries: [] })} action={action} />);
    try {
      expect(container.textContent).toContain("No suggestions yet.");
      expect(dayNoteShortcutsSectionState(view({ state: null, entries: [] })).text).toBe("On");
    } finally {
      await unmount();
    }
  });

  it("hides suggestions and editing while the retained account switch is off", async () => {
    const action: NoteShortcutAction = async () => ({ status: "idle", message: "" });
    const { container, unmount } = await render(<DayNoteShortcutSettings view={view({ globalEnabled: false })} action={action} />);
    try {
      expect(button(container, "Edit")).toBeUndefined();
      expect(container.textContent).not.toContain("Rest day");
      expect(container.textContent).toContain("Note shortcuts are turned off for this account.");
      expect(dayNoteShortcutsSectionState(view({ globalEnabled: false })).text).toBe("Off for this account");
    } finally {
      await unmount();
    }
  });
});

describe("Day note shortcut chips", () => {
  it("shows accepted day-note shortcuts in the day-note editor and never proposals", async () => {
    const { container, unmount } = await render(
      <RefreshProvider onRefresh={() => undefined}>
        <DayNoteControl localDate="2026-11-10" dayLabel="Tuesday" note="" action={async () => ({ status: "idle", message: "" })}
          shortcuts={[shortcut("Travel day"), shortcut("Rest day", "proposed")]} />
      </RefreshProvider>,
    );
    try {
      const chips = container.querySelector('[aria-label="Day note shortcuts"]')!;
      expect(chips.textContent).toBe("Travel day");
      await act(async () => button(container, "Travel day")!.click());
      expect(container.querySelector("textarea")!.value).toBe("Travel day");
      expect((container.querySelector('input[name="used_shortcut"]') as HTMLInputElement).value).toBe("true");
    } finally {
      await unmount();
    }
  });
});
