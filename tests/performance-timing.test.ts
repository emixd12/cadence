import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isPerformanceTimingEnabled,
  measurePerformanceSpan,
  withPerformanceRoute,
} from "@/lib/services/performance-timing";

describe("performance timing", () => {
  const originalFlag = process.env.CADENCE_PERF_LOG;

  afterEach(() => {
    process.env.CADENCE_PERF_LOG = originalFlag;
    vi.restoreAllMocks();
  });

  it("stays silent unless CADENCE_PERF_LOG is enabled", async () => {
    delete process.env.CADENCE_PERF_LOG;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      measurePerformanceSpan({ span: "db.list_user_behaviors" }, async () => 1),
    ).resolves.toBe(1);

    expect(isPerformanceTimingEnabled()).toBe(false);
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("logs route, span, duration, status, and safe aggregate counts", async () => {
    process.env.CADENCE_PERF_LOG = "1";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      withPerformanceRoute(
        "/timeline",
        "page.bundle_load",
        () =>
          measurePerformanceSpan(
            {
              span: "db.list_user_behaviors",
              counts: {
                behaviors: 3,
                occurrences: 8.2,
                behavior_title_count: 99,
                token_count: 2,
              },
            },
            async () => ["ok"],
          ),
        {
          counts: {
            page_loads: 1,
          },
        },
      ),
    ).resolves.toEqual(["ok"]);

    expect(isPerformanceTimingEnabled()).toBe(true);
    expect(consoleInfo).toHaveBeenCalledTimes(2);

    const nestedEvent = JSON.parse(
      String(consoleInfo.mock.calls[0]?.[0]),
    ) as Record<string, unknown>;

    expect(nestedEvent).toMatchObject({
      source: "cadence",
      kind: "performance_timing",
      route: "/timeline",
      span: "db.list_user_behaviors",
      status: "success",
      counts: {
        behaviors: 3,
        occurrences: 8,
      },
    });
    expect(nestedEvent).not.toHaveProperty("behavior_title_count");
    expect(nestedEvent).not.toHaveProperty("token_count");
    expect(typeof nestedEvent.duration_ms).toBe("number");
  });

  it("logs error status and error type without error messages", async () => {
    process.env.CADENCE_PERF_LOG = "1";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      measurePerformanceSpan({ span: "service.example" }, async () => {
        throw new TypeError("Private note for person@example.com");
      }),
    ).rejects.toThrow("Private note");

    const event = JSON.parse(
      String(consoleInfo.mock.calls[0]?.[0]),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(event);

    expect(event).toMatchObject({
      source: "cadence",
      kind: "performance_timing",
      route: null,
      span: "service.example",
      status: "error",
      error_name: "TypeError",
    });
    expect(serialized).not.toContain("Private note");
    expect(serialized).not.toContain("person@example.com");
  });

  it("adds only short machine error codes", async () => {
    process.env.CADENCE_PERF_LOG = "1";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(measurePerformanceSpan({ span: "service.coded" }, async () => {
      throw Object.assign(new Error("Private"), { code: "rate_limited" });
    })).rejects.toThrow();
    await expect(measurePerformanceSpan({ span: "service.uncoded" }, async () => {
      throw Object.assign(new Error("Private"), { code: "Private note for person@example.com" });
    })).rejects.toThrow();
    const [coded, uncoded] = consoleInfo.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(coded).toMatchObject({ error_code: "rate_limited" });
    expect(uncoded).not.toHaveProperty("error_code");
  });

  it("redacts uuid-shaped route and span segments", async () => {
    process.env.CADENCE_PERF_LOG = "1";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const id = "4fd91c27-ff2d-40af-95bb-64501d7d1e27";

    await withPerformanceRoute(
      `/timeline/${id}`,
      `db.get_${id}`,
      async () => null,
    );

    const event = JSON.parse(
      String(consoleInfo.mock.calls[0]?.[0]),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain(id);
    expect(event.route).toBe("/timeline/_id_");
    expect(event.span).toBe("db.get__id_");
  });
});
