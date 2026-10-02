import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".agents/**",
    ".local/**",
    ".astro/**",
    "**/.astro/**",
    ".next/**",
    "apps/marketing/dist/**",
    "apps/desktop/dist/**",
    "apps/desktop/src-tauri/target/**",
    "apps/desktop/src-tauri/gen/**",
    "load-tests/.runs/**",
    "load-tests/.venv/**",
    "load-tests/**/__pycache__/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored upstream BehaviorLog validator; pinned by SHA-256 in tests/fixtures/behaviorlog-reference/SNAPSHOT.md.
    "tests/fixtures/behaviorlog-reference/validate.mjs",
  ]),
]);

export default eslintConfig;
