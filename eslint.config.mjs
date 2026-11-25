import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Reading Web Storage can throw (blocked site data, some private modes) and it is absent
// during server rendering. lib/ui/browser-storage.ts holds the one guarded access.
const STORAGE_MESSAGE =
  "Use getLocalStorage/getSessionStorage/readLocalItem/writeLocalItem from @/lib/ui/browser-storage instead; reading Web Storage directly can throw.";
const STORAGE_NAMES = ["localStorage", "sessionStorage"];
const STORAGE_OWNERS = ["window", "globalThis", "self"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["lib/ui/browser-storage.ts", "tests/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...STORAGE_NAMES.map((name) => ({ name, message: STORAGE_MESSAGE })),
      ],
      "no-restricted-properties": [
        "error",
        ...STORAGE_OWNERS.flatMap((object) =>
          STORAGE_NAMES.map((property) => ({ object, property, message: STORAGE_MESSAGE })),
        ),
      ],
    },
  },
  globalIgnores([
    ".agents/**",
    ".local/**",
    ".claude/**",
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
