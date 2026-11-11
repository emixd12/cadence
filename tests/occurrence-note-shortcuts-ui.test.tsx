// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import type { NoteShortcutCommand } from "@cadence/core/types/note-shortcut";
import { NoteShortcutSettings, type NoteShortcutAction } from "../components/note-shortcuts/NoteShortcutControls";
import { OccurrenceNoteForm } from "../components/timeline/OccurrenceNoteForm";
import { hasPendingDesktopWrites, hasUnsavedDesktopDrafts } from "../apps/desktop/src/desktop-restart";
import type { OccurrenceFormAction } from "../lib/types/timeline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Occurrence Note shortcuts", () => {
  it("uses the first saved Note as the expected value for a second edit", async () => {
    let storedNote = "";
    const submissions: FormData[] = [];
    const action: OccurrenceFormAction = async (_state, form) => {
      submissions.push(form);
      if (form.get("expected_note") !== storedNote) {
        return { status: "error", message: "This note changed elsewhere." };
      }
      storedNote = String(form.get("note")).trim();
      return { status: "success", message: "Note saved." };
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => root.render(
        <RefreshProvider onRefresh={() => undefined}>
          <OccurrenceNoteForm occurrenceId="occurrence-1" note="" action={action} shortcuts={[shortcut()]} />
        </RefreshProvider>,
      ));
      const form = container.querySelector("form")!;
      await act(async () => button(container, "Took a shorter walk.").click());
      await act(async () => form.requestSubmit(button(container, "Save note")));

      expect(storedNote).toBe("Took a shorter walk.");
      expect(submissions[0]?.get("expected_note")).toBe("");
      expect(submissions[0]?.get("used_shortcut")).toBe("true");

      const textarea = container.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Took a longer walk.");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => form.requestSubmit(button(container, "Save note")));

      expect(submissions).toHaveLength(2);
      expect(submissions[1]?.get("expected_note")).toBe("Took a shorter walk.");
      expect(submissions[1]?.get("used_shortcut")).toBe("false");
      expect(storedNote).toBe("Took a longer walk.");
      expect(container.querySelector('[role="status"]')?.textContent).toBe("Note saved.");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("keeps a pending shortcut draft while an external Note change causes a conflict", async () => {
    let storedNote = "Original note";
    const action: OccurrenceFormAction = async (_state, form) => {
      if (form.get("expected_note") !== storedNote) {
        return { status: "error", message: "This note changed elsewhere." };
      }
      storedNote = String(form.get("note")).trim();
      return { status: "success", message: "Note saved." };
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderForm = (note: string) => (
      <RefreshProvider onRefresh={() => undefined}>
        <OccurrenceNoteForm occurrenceId="occurrence-1" note={note} action={action} shortcuts={[shortcut()]} />
      </RefreshProvider>
    );

    try {
      await act(async () => root.render(renderForm(storedNote)));
      await act(async () => button(container, "Took a shorter walk.").click());
      storedNote = "Changed on another device";
      await act(async () => root.render(renderForm(storedNote)));

      const form = container.querySelector("form")!;
      expect(new FormData(form).get("note")).toBe("Original note\nTook a shorter walk.");
      expect(new FormData(form).get("expected_note")).toBe("Original note");
      expect(new FormData(form).get("used_shortcut")).toBe("true");

      await act(async () => form.requestSubmit(button(container, "Save note")));

      expect(container.querySelector('[role="alert"]')?.textContent).toBe("This note changed elsewhere.");
      expect(new FormData(form).get("note")).toBe("Original note\nTook a shorter walk.");
      expect(new FormData(form).get("expected_note")).toBe("Original note");
      expect(new FormData(form).get("used_shortcut")).toBe("true");
      expect(storedNote).toBe("Changed on another device");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("preserves a shortcut inserted during a pending save for the next submitted draft", async () => {
    let finishSave: ((state: { status: "success"; message: string }) => void) | undefined;
    const submissions: FormData[] = [];
    const action: OccurrenceFormAction = async (_state, form) => {
      submissions.push(form);
      if (submissions.length > 1) return { status: "success", message: "Note saved." };
      return new Promise((resolve) => { finishSave = resolve; });
    };
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    try {
      await act(async () => root.render(
        <RefreshProvider onRefresh={() => undefined}>
          <OccurrenceNoteForm occurrenceId="occurrence-1" note="Warm-up" action={action} shortcuts={[shortcut()]} />
        </RefreshProvider>,
      ));
      const form = container.querySelector("form")!;
      const shortcutButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Took a shorter walk.")!;
      const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save note")!;

      await act(async () => form.requestSubmit(saveButton));
      expect(finishSave).toBeDefined();
      expect(saveButton.disabled).toBe(true);
      expect(hasPendingDesktopWrites()).toBe(true);
      await act(async () => shortcutButton.click());

      expect(new FormData(form).get("note")).toBe("Warm-up\nTook a shorter walk.");
      expect(new FormData(form).get("used_shortcut")).toBe("true");

      await act(async () => finishSave!({ status: "success", message: "Note saved." }));
      expect(new FormData(form).get("note")).toBe("Warm-up\nTook a shorter walk.");
      expect(new FormData(form).get("used_shortcut")).toBe("true");
      expect(hasPendingDesktopWrites()).toBe(false);
      expect(hasUnsavedDesktopDrafts()).toBe(true);
      await act(async () => form.requestSubmit(button(container, "Save note")));
      expect(submissions).toHaveLength(2);
      expect(submissions[1]?.get("note")).toBe("Warm-up\nTook a shorter walk.");
      expect(submissions[1]?.get("used_shortcut")).toBe("true");
      expect(hasUnsavedDesktopDrafts()).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps an edited shortcut draft after a management error", async () => {
    let expectedRevision = "";
    const action: NoteShortcutAction = async (_behaviorId, _command, revision) => {
      expectedRevision = revision;
      return { status: "error", message: "Shortcut changed elsewhere." };
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => root.render(<NoteShortcutSettings behaviorId="behavior-1" view={view()} action={action} />));
      await act(async () => button(container, "Edit").click());
      const textarea = container.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Edited shortcut");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => button(container, "Save shortcut").click());

      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Shortcut changed elsewhere.");
      expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Edited shortcut");
      expect(expectedRevision).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("never exposes proposed shortcuts in an Occurrence Note form", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const proposed = { ...shortcut(), key: "proposal-1", text: "Draft proposal", status: "proposed" as const };

    try {
      await act(async () => root.render(
        <RefreshProvider onRefresh={() => undefined}>
          <OccurrenceNoteForm occurrenceId="occurrence-1" note="" action={async () => ({ status: "idle", message: "" })} shortcuts={[shortcut(), proposed]} />
        </RefreshProvider>,
      ));
      expect(container.textContent).toContain("Took a shorter walk.");
      expect(container.textContent).not.toContain("Draft proposal");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("uses refreshed accepted text when editing the same shortcut key", async () => {
    const action: NoteShortcutAction = async () => ({ status: "idle", message: "" });
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => root.render(<NoteShortcutSettings behaviorId="behavior-1" view={view("First text")} action={action} />));
      await act(async () => root.render(<NoteShortcutSettings behaviorId="behavior-1" view={view("Fresh text")} action={action} />));
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
      await act(async () => button(container, "Edit").click());
      expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Fresh text");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("hides analysis and accepted-text editing while shortcuts are globally off", async () => {
    const action: NoteShortcutAction = async () => ({ status: "idle", message: "" });
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => root.render(<NoteShortcutSettings behaviorId="behavior-1" view={{ ...view(), globalEnabled: false }} action={action} />));
      expect(button(container, "Edit")).toBeUndefined();
      expect(button(container, "Remove")).toBeDefined();
      expect(container.textContent).toContain("Note shortcuts are turned off for this account.");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("renders no enable switch or find action and needs Accept before a proposal is used", async () => {
    const commands: NoteShortcutCommand[] = [];
    const proposed = { ...shortcut("Skipped after travel"), key: "proposal-1", status: "proposed" as const, evidence: [], expires_at: "2026-10-07T00:00:00Z" };
    const base = view();
    const pendingView = { ...base, state: { ...base.state, enabled: false, entries: [shortcut(), proposed] }, entries: [shortcut(), proposed] };
    const action: NoteShortcutAction = async (_behaviorId, command) => {
      commands.push(command);
      return { status: "success", message: "Note shortcut accepted." };
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      // The stored per-Behavior flag is off: proposals still show, with no switch to turn on.
      await act(async () => root.render(<NoteShortcutSettings behaviorId="behavior-1" view={pendingView} action={action} />));
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
      expect(button(container, "Find repeated Notes")).toBeUndefined();
      expect(container.textContent).not.toContain("Enable Note shortcuts");
      const proposals = container.querySelector('[aria-label="Proposed Note shortcuts"]')!;
      expect(proposals.textContent).toContain("Skipped after travel");
      expect([...proposals.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["Accept", "Edit", "Dismiss"]);
      expect(commands).toEqual([]);

      await act(async () => [...proposals.querySelectorAll("button")].find((item) => item.textContent === "Accept")!.click());
      expect(commands).toEqual([{ operation: "accept", key: "proposal-1", text: "Skipped after travel" }]);
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Proposed Note shortcuts"] button')].find((item) => item.textContent === "Dismiss")!.click());
      expect(commands[1]).toEqual({ operation: "dismiss", key: "proposal-1" });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("offers only accepted shortcuts above an Occurrence Note field", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const proposed = { ...shortcut("Skipped after travel"), key: "proposal-1", status: "proposed" as const };

    try {
      await act(async () => root.render(
        <RefreshProvider onRefresh={() => undefined}>
          <OccurrenceNoteForm occurrenceId="occurrence-1" note="" action={async () => ({ status: "idle", message: "" })} shortcuts={[proposed]} />
        </RefreshProvider>,
      ));
      expect(button(container, "Skipped after travel")).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
}

function view(text = "Took a shorter walk.") {
  return {
    state: {
      id: "state-1", user_id: "user-1", behavior_id: "behavior-1", enabled: true,
      entries: [shortcut(text)], excluded_occurrence_ids: [], revision: 1, updated_at: "2026-09-07T00:00:00Z",
    },
    globalEnabled: true,
    available: true,
    entries: [shortcut(text)],
  };
}

function shortcut(text = "Took a shorter walk.") {
  return {
    key: "shortcut-1",
    text,
    status: "accepted" as const,
    source: "repeated_text" as const,
    evidence: [],
    created_at: "2026-09-07T00:00:00Z",
    expires_at: null,
  };
}
