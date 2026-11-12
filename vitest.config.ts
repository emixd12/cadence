import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The web client runner tests drive headless Chrome for about ten minutes and
 * only cover the acceptance tooling under scripts/. `npm run test` skips them.
 * `npm run test:web-client` and the "Web client runner" workflow run them.
 */
const WEB_CLIENT_TEST = "tests/acceptance-web-client.test.mjs";
const runWebClientTest = process.env.CADENCE_WEB_CLIENT_TEST === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".local/**",
      ".claude/**",
      ...(runWebClientTest ? [] : [WEB_CLIENT_TEST]),
    ],
    environment: "node",
    globals: true,
  },
});
