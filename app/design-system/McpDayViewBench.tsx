"use client";

import { useEffect, useRef, useState } from "react";

import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { FIXTURE_DAYS, type FixtureDayId } from "@/packages/mcp-views/src/fixtures";
import { createMockHost, READ_ONLY_SCOPES, type MockHost, type MockHostLogEntry, type MockHostOptions } from "@/packages/mcp-views/src/mock-host";

/**
 * Bench for the "Cadence day" MCP Apps view (Ticket 377, D36).
 * /design-system?preview=mcp-day-view&state=<state>&theme=light|dark&host=cadence|claude&layout=phone|desktop
 *
 * The frame holds the shipped bundle (lib/mcp/apps/day-view-html.ts), sandboxed with
 * scripts only, exactly as an AI client would run it. A mock host on this page answers
 * the MCP Apps protocol from a fixture day and applies writes to it. Nothing is saved
 * and nothing leaves the page. The bench chrome is neutral on purpose; only the frame
 * shows the view.
 */
type Scenario = Readonly<{ label: string; about: string; day: FixtureDayId; host?: Partial<Omit<MockHostOptions, "post" | "day">> }>;

const MCP_DAY_VIEW_STATES = {
  normal: { label: "Normal day", about: "Rows, a day note, a moved item and four earlier items in Needs decision. Writes apply.", day: "normal" },
  empty: { label: "Empty day", about: "No Occurrences and nothing in Needs decision.", day: "empty" },
  "read-only": { label: "Read-only grant", about: "The grant lacks the write scope, so the reconnect line replaces the controls.", day: "parent", host: { scopes: READ_ONLY_SCOPES } },
  conflict: { label: "Conflict", about: "The first write finds the item changed somewhere else. The view reloads the day and asks again.", day: "normal", host: { writes: "conflict-once" } },
  "rate-limit": { label: "Rate limit", about: "The first write is refused for 8 seconds. Controls wait, then the same action goes through.", day: "normal", host: { writes: "rate-limit-once", retryAfterSeconds: 8 } },
  rejected: { label: "Rejected call", about: "The host rejects every write and passes no scopes at first, as an SDK-built host does on a step-up challenge. The reload shows a read-only grant.", day: "normal", host: { initialScopes: null, scopes: READ_ONLY_SCOPES, writes: "reject" } },
  connector: { label: "Connector completion", about: "Hevy marked Gym Completed. The row says so, and the person can still change it.", day: "connector" },
  parent: { label: "Parent slot", about: "A routine collapsed to its progress. Open it for the steps; mark the slot or one step.", day: "parent" },
  opportunity: { label: "Opportunity rows", about: "Rows added from the person's opportunities, by each source.", day: "opportunity" },
  alongside: { label: "Alongside variants", about: "The field is true, false, null and absent. Only the first row shows the label.", day: "alongside" },
  hostile: { label: "Long and hostile text", about: "Markup, script and very long words in titles, notes and the day note. All of it shows as text.", day: "hostile" },
  "many-earlier": { label: "More than 100 earlier", about: "The server reports 100 and says more exist.", day: "manyEarlier" },
  loading: { label: "Loading", about: "The host has not sent a result yet.", day: "normal", host: { result: "never" } },
  unavailable: { label: "Unavailable", about: "The host cancelled the call.", day: "normal", host: { result: "cancelled" } },
} satisfies Record<string, Scenario>;

type McpDayViewState = keyof typeof MCP_DAY_VIEW_STATES;
type McpDayViewHostStyle = "cadence" | "claude";
type Theme = "light" | "dark";
type Width = "phone" | "desktop";

/** Claude's published style variables (design guidelines, read 2026-11-25). "cadence" sends none, so the view's own fallbacks show. */
const CLAUDE_VARIABLES: Record<Theme, Record<string, string>> = {
  light: {
    "--color-background-primary": "#FFFFFF", "--color-background-secondary": "#F5F4ED", "--color-background-inverse": "#141413",
    "--color-text-primary": "#141413", "--color-text-secondary": "#3D3D3A", "--color-text-inverse": "#FFFFFF", "--color-text-danger": "#7F2C28",
    "--color-text-disabled": "rgba(20, 20, 19, 0.5)", "--color-border-primary": "rgba(31, 30, 29, 0.4)", "--color-border-secondary": "rgba(31, 30, 29, 0.3)",
    "--color-ring-primary": "rgba(20, 20, 19, 0.7)",
  },
  dark: {
    "--color-background-primary": "#30302E", "--color-background-secondary": "#262624", "--color-background-inverse": "#FAF9F5",
    "--color-text-primary": "#FAF9F5", "--color-text-secondary": "#C2C0B6", "--color-text-inverse": "#141413", "--color-text-danger": "#EE8884",
    "--color-text-disabled": "rgba(250, 249, 245, 0.5)", "--color-border-primary": "rgba(222, 220, 209, 0.4)", "--color-border-secondary": "rgba(222, 220, 209, 0.3)",
    "--color-ring-primary": "rgba(250, 249, 245, 0.7)",
  },
};
const CLAUDE_SHARED = {
  "--font-sans": "system-ui, sans-serif", "--font-weight-normal": "400", "--font-weight-semibold": "600",
  "--font-text-xs-size": "12px", "--font-text-sm-size": "14px", "--font-text-md-size": "16px", "--font-heading-md-size": "16px",
  "--font-text-sm-line-height": "1.4", "--font-heading-md-line-height": "1.4", "--border-radius-md": "8px",
};
const WIDTHS: Record<Width, number> = { phone: 375, desktop: 720 };
const CARD: Record<McpDayViewHostStyle, Record<Theme, string>> = {
  cadence: { light: "#fdfcfb", dark: "#0a0b0c" },
  claude: { light: "#FFFFFF", dark: "#30302E" },
};

const variablesFor = (style: McpDayViewHostStyle, theme: Theme) => (style === "claude" ? { ...CLAUDE_VARIABLES[theme], ...CLAUDE_SHARED } : undefined);

function logLine(entry: MockHostLogEntry): string {
  if (entry.kind === "tool") return `tools/call ${entry.name} → ${entry.outcome}`;
  if (entry.kind === "model-context") return `ui/update-model-context: ${entry.text}`;
  return `${entry.method} (not answered)`;
}

/** The page passes the query values as they came; anything unknown falls back to the first choice. */
type BenchProps = Readonly<{ state?: string; theme?: string; host?: string; layout?: string }>;

export function McpDayViewBench(props: BenchProps) {
  const state: McpDayViewState = props.state && props.state in MCP_DAY_VIEW_STATES ? (props.state as McpDayViewState) : "normal";
  const initialTheme: Theme = props.theme === "dark" ? "dark" : "light";
  const hostStyle: McpDayViewHostStyle = props.host === "claude" ? "claude" : "cadence";
  const width: Width = props.layout === "desktop" ? "desktop" : "phone";
  const scenario: Scenario = MCP_DAY_VIEW_STATES[state];
  const frame = useRef<HTMLIFrameElement | null>(null);
  const host = useRef<MockHost | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [height, setHeight] = useState(160);
  const [log, setLog] = useState<readonly string[]>([]);

  // The mock host listens before the frame gets its document, so the handshake is never missed.
  useEffect(() => {
    const mock = createMockHost({
      ...scenario.host,
      day: FIXTURE_DAYS[scenario.day](),
      theme: initialTheme,
      styleVariables: variablesFor(hostStyle, initialTheme),
      post: (message) => frame.current?.contentWindow?.postMessage(message, "*"),
      onSize: (size) => { if (typeof size.height === "number") setHeight(Math.ceil(size.height)); },
      onLog: (entry) => setLog((lines) => [...lines, logLine(entry)]),
    });
    host.current = mock;
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) mock.receive(event.data);
    };
    window.addEventListener("message", onMessage);
    if (frame.current) frame.current.srcdoc = DAY_VIEW_HTML;
    return () => window.removeEventListener("message", onMessage);
  }, [scenario, initialTheme, hostStyle]);

  const switchTheme = (next: Theme) => {
    setTheme(next);
    host.current?.setTheme(next, variablesFor(hostStyle, next));
  };

  const link = (query: Partial<{ state: string; theme: Theme; host: McpDayViewHostStyle; layout: Width }>) => {
    const all = { state, theme, host: hostStyle, layout: width, ...query };
    return `?preview=mcp-day-view&state=${all.state}&theme=${all.theme}&host=${all.host}&layout=${all.layout}`;
  };
  const choice = (current: boolean) => ({ fontWeight: current ? 700 : 400, textDecoration: current ? "none" : "underline" });

  return (
    <main style={{ fontFamily: "Arial, Helvetica, sans-serif", background: "#f5f5f5", color: "#171717", minHeight: "100dvh", padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <a href="/design-system" style={{ textDecoration: "underline", fontSize: 14 }}>Back to the design-system bench</a>
        <header style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Cadence day view (MCP Apps, Ticket 377)</h1>
          <p style={{ fontSize: 14, margin: 0, maxWidth: "70ch" }}>
            The frame runs the shipped bundle in a sandbox with scripts only. A mock host on this page answers from a fixture day. Nothing is saved.
          </p>
        </header>

        <nav aria-label="Fixture state" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 14 }}>
          {(Object.keys(MCP_DAY_VIEW_STATES) as McpDayViewState[]).map((id) => (
            <a key={id} href={link({ state: id })} aria-current={id === state ? "page" : undefined} style={choice(id === state)}>{MCP_DAY_VIEW_STATES[id].label}</a>
          ))}
        </nav>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", fontSize: 14 }}>
          <span>
            Theme:{" "}
            <button type="button" data-bench-theme="light" aria-pressed={theme === "light"} style={{ ...choice(theme === "light"), marginRight: 8 }} onClick={() => switchTheme("light")}>Light</button>
            <button type="button" data-bench-theme="dark" aria-pressed={theme === "dark"} style={choice(theme === "dark")} onClick={() => switchTheme("dark")}>Dark</button>
          </span>
          <span>
            Host variables:{" "}
            <a href={link({ host: "cadence" })} style={{ ...choice(hostStyle === "cadence"), marginRight: 8 }}>None (Cadence fallbacks)</a>
            <a href={link({ host: "claude" })} style={choice(hostStyle === "claude")}>Claude&apos;s</a>
          </span>
          <span>
            Width:{" "}
            <a href={link({ layout: "phone" })} style={{ ...choice(width === "phone"), marginRight: 8 }}>Phone, 375px</a>
            <a href={link({ layout: "desktop" })} style={choice(width === "desktop")}>Desktop, 720px</a>
          </span>
        </div>
        <p style={{ fontSize: 14, margin: 0 }}><strong>{scenario.label}.</strong> {scenario.about}</p>

        <section aria-label="The view in its host frame" data-bench-card
          style={{ width: WIDTHS[width], maxWidth: "100%", background: CARD[hostStyle][theme], border: "1px solid #a3a3a3", borderRadius: 12, overflow: "hidden" }}>
          <iframe ref={frame} title="Cadence day" sandbox="allow-scripts"
            style={{ display: "block", width: "100%", height, border: 0, background: "transparent" }} />
        </section>

        <section aria-label="What the view sent to the host" style={{ fontSize: 13 }}>
          <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>Sent to the host</h2>
          {log.length === 0 ? <p style={{ margin: 0 }}>Nothing yet. Reads and writes from the view appear here.</p> : (
            <ol data-bench-log style={{ margin: 0, paddingLeft: 20, fontFamily: "ui-monospace, monospace" }}>
              {log.map((line, index) => <li key={index}>{line}</li>)}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
