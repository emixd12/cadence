// Runs the SHIPPED "Cadence day" bundle (lib/mcp/apps/day-view-html.ts) in a jsdom window
// with no network: jsdom loads no subresource, and every network API is replaced by a
// recorder. The mock host stands where an AI client's frame would be.
import { JSDOM } from "jsdom";

import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { createMockHost, type MockHost, type MockHostOptions } from "@/packages/mcp-views/src/mock-host";

export type MountedDayView = Readonly<{
  window: JSDOM["window"];
  document: Document;
  host: MockHost;
  /** Every network attempt the view made. Must stay empty. */
  network: readonly string[];
  errors: readonly string[];
  main(): HTMLElement;
  row(title: string): HTMLElement;
  click(element: Element | null | undefined): Promise<void>;
  type(textarea: HTMLTextAreaElement, text: string): Promise<void>;
  settle(): Promise<void>;
  waitFor(check: () => boolean, label: string): Promise<void>;
  toolCalls(name?: string): { name: string; arguments: Record<string, unknown>; outcome: string }[];
  modelContext(): string[];
  close(): void;
}>;

const INLINE_MODULE = /<script type="module"[^>]*>([\s\S]*?)<\/script>/;

export function inlineScript(html: string = DAY_VIEW_HTML): string {
  const match = INLINE_MODULE.exec(html);
  if (!match) throw new Error("The view bundle has no inline module script.");
  return match[1]!;
}

export async function mountDayView(options: Omit<MockHostOptions, "post">): Promise<MountedDayView> {
  const dom = new JSDOM(DAY_VIEW_HTML, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://view.invalid/" });
  const window = dom.window;
  const network: string[] = [];
  const errors: string[] = [];
  window.addEventListener("error", (event: ErrorEvent) => errors.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event: Event) => errors.push(String((event as PromiseRejectionEvent).reason)));

  const blocked = (kind: string) => function recorder(this: unknown, ...args: unknown[]) {
    network.push(`${kind} ${String(args[0] ?? "")}`);
    throw new Error(`${kind} is blocked in the view`);
  };
  const globals = window as unknown as Record<string, unknown>;
  globals.fetch = (...args: unknown[]) => {
    network.push(`fetch ${String(args[0])}`);
    return Promise.reject(new Error("fetch is blocked in the view"));
  };
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "Image"]) globals[name] = blocked(name);
  Object.defineProperty(window.navigator, "sendBeacon", { value: blocked("sendBeacon"), configurable: true });
  globals.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globals.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  // The host frame: the view posts to `window.parent`, and accepts only messages whose source is that parent.
  const parent = { postMessage: (message: unknown) => { window.setTimeout(() => host.receive(message), 0); } };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  const host: MockHost = createMockHost({
    ...options,
    post(message) {
      const event = new window.MessageEvent("message", { data: message, origin: "https://host.invalid" });
      Object.defineProperty(event, "source", { value: parent });
      window.dispatchEvent(event);
    },
  });

  window.eval(inlineScript());

  const settle = async () => {
    for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  };
  const waitFor = async (check: () => boolean, label: string) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > 4000) throw new Error(`Timed out waiting for ${label}. Errors: ${errors.join(" | ") || "none"}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const main = () => window.document.querySelector("main") as HTMLElement;

  await waitFor(() => Boolean(main()), "the view to render");
  await settle();

  return {
    window,
    document: window.document,
    host,
    network,
    errors,
    main,
    row(title) {
      const rows = [...window.document.querySelectorAll<HTMLElement>("li[data-occurrence], li[data-group]")];
      const found = rows.find((row) => row.querySelector(".title")?.textContent === title);
      if (!found) throw new Error(`No row titled ${title}`);
      return found;
    },
    async click(element) {
      if (!element) throw new Error("Nothing to click");
      (element as HTMLElement).click();
      await settle();
    },
    async type(textarea, text) {
      textarea.value = text;
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      await settle();
    },
    settle,
    waitFor,
    toolCalls(name) {
      return host.log.flatMap((entry) => (entry.kind === "tool" && (!name || entry.name === name) ? [{ name: entry.name, arguments: entry.arguments, outcome: entry.outcome }] : []));
    },
    modelContext() {
      return host.log.flatMap((entry) => (entry.kind === "model-context" ? [entry.text] : []));
    },
    close() {
      window.close();
    },
  };
}
