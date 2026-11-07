// @vitest-environment jsdom
// Ticket 285: main.tsx wraps Product in the app-level boundary. A render error in the shell must
// show the recovery message instead of unmounting the root and leaving a blank window.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ failProduct: true }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../apps/desktop/src/native-coverage-probe", () => ({ runNativeCoverageProbe: vi.fn() }));
vi.mock("../apps/desktop/src/product", () => ({
  Product: () => {
    if (mocks.failProduct) throw new Error("Synthetic shell render failure");
    return <main>Product rendered</main>;
  },
}));

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

beforeEach(() => {
  vi.resetModules();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.history.replaceState(null, "", "/");
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
});
afterEach(() => {
  document.getElementById("root")?.remove();
  vi.restoreAllMocks();
});

describe("desktop main entry", () => {
  it("shows the app recovery message when Product throws while rendering", async () => {
    mocks.failProduct = true;
    await act(async () => { await import("../apps/desktop/src/main"); });
    await settle();
    const alert = document.querySelector('#root main[role="alert"]');
    expect(alert?.textContent).toBe("Cadence could not open. Quit and reopen the app to try again.");
    // The boundary logs the error and component stack only.
    expect(console.error).toHaveBeenCalledWith("Cadence desktop render error", expect.any(Error), expect.any(String));
  });

  it("renders Product normally when it does not throw", async () => {
    mocks.failProduct = false;
    await act(async () => { await import("../apps/desktop/src/main"); });
    await settle();
    expect(document.getElementById("root")?.textContent).toBe("Product rendered");
  });
});
