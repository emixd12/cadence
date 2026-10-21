import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { runOAuthMaintenance } from "@/lib/services/oauth-maintenance.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/database.types";

vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it("settles the actual Supabase/Node transport after eight seconds, including a stalled response body", async () => {
  let calls = 0;
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  const server = createServer((request, response) => {
    calls++;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/rest/v1/rpc/oauth_purge_expired");
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"authorization_codes":');
    response.on("close", disconnected);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  vi.mocked(createServiceRoleClient).mockReturnValue(createClient<Database>(
    `http://127.0.0.1:${port}`, "synthetic-local-test-key",
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const started = performance.now();
    await runOAuthMaintenance();
    expect(performance.now() - started).toBeGreaterThanOrEqual(7900);
    expect(performance.now() - started).toBeLessThan(10000);
    await closed;
    expect(calls).toBe(1);
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      name: "oauth_maintenance_timed_out", context: { outcome: "unknown" },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 12000);
