// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeTracker } from "@/components/timeline/TimeTracker";
import type { TimeTrackingFormAction } from "@/lib/types/timeline";

const action: TimeTrackingFormAction = async (state) => state;

describe("TimeTracker visibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T14:00:00Z"));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pauses hidden timers, refreshes elapsed time on visibility, and cleans up", async () => {
    await act(() => root.render(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 0, runningStartedAt: "2026-08-02T14:00:00Z" }}
        canStart
        startAction={action}
        stopAction={action}
        resetAction={action}
      />,
    ));
    expect(container.textContent).toContain("00:00:00");
    expect(vi.getTimerCount()).toBe(1);

    hidden = true;
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(6 * 60 * 60_000));
    expect(container.textContent).toContain("00:00:00");

    hidden = false;
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.textContent).toContain("06:00:00");
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(container.textContent).toContain("06:00:01");

    await act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("switches to stopped state when refreshed tracking props stop a locally started timer", async () => {
    const startAction: TimeTrackingFormAction = async (_prev, formData) => ({
      status: "success",
      message: "Time tracking started.",
      requestId: String(formData.get("client_action_id") ?? ""),
      tracking: {
        recordedSeconds: 0,
        runningStartedAt: "2026-08-02T14:00:00Z",
      },
    });

    await act(() => root.render(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 0, runningStartedAt: null }}
        canStart
        startAction={startAction}
        stopAction={action}
        resetAction={action}
      />,
    ));

    const startButton = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(startButton.textContent).toBe("Track Time");
    await act(async () => {
      startButton.click();
    });
    expect(container.textContent).toContain("Stop");
    expect(vi.getTimerCount()).toBe(1);

    // Simulates Completed auto-stopping the running session and refreshing props.
    await act(() => root.render(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 900, runningStartedAt: null }}
        canStart
        startAction={startAction}
        stopAction={action}
        resetAction={action}
      />,
    ));

    expect(container.textContent).toContain("00:15:00");
    expect(container.textContent).not.toContain("Stop");
    expect(vi.getTimerCount()).toBe(0);
  });
});
