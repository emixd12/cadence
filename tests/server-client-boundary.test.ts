import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A server component that imports from a "use client" module receives client
// references, not the module's values. Rendering a client component from that
// reference works. Calling an exported function fails at render time ("Attempted
// to call drawerLabel() from the server but drawerLabel is on the client"), and
// build, typecheck and unit tests do not see it. Shared copy and helpers belong in
// a module without "use client". This scan covers every server module under app/.

const root = path.resolve(__dirname, "..");
const resolveSuffixes = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Skips leading whitespace and comments with a linear scan, then checks the directive. */
export function isClientModule(source: string): boolean {
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) index += 1;
    else if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      if (end === -1) return false;
      index = end + 1;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return false;
      index = end + 2;
    } else break;
  }
  return source.startsWith('"use client"', index) || source.startsWith("'use client'", index);
}

function resolveImport(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const suffix of resolveSuffixes) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** A React component name: PascalCase, not SCREAMING_CASE. */
function isComponentName(name: string): boolean {
  return /^[A-Z][a-z0-9]/.test(name) && !/^[A-Z0-9_]+$/.test(name);
}

/** Lists non-component values a server module imports from "use client" modules. */
export function serverImportsOfClientValues(files: readonly string[]): string[] {
  const findings: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (isClientModule(source)) continue;
    for (const match of source.matchAll(/import\s+(type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      if (match[1]) continue;
      const target = resolveImport(match[3], file);
      if (!target || !isClientModule(fs.readFileSync(target, "utf8"))) continue;
      const names = match[2]
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith("type "))
        .map((part) => part.split(/\s+as\s+/)[0]);
      for (const name of names.filter((value) => !isComponentName(value))) {
        findings.push(`${path.relative(root, file)} imports ${name} from "use client" ${match[3]}`);
      }
    }
  }
  return findings;
}

describe("server and client module boundary", () => {
  it("keeps server modules under app/ from reading values exported by client modules", () => {
    expect(serverImportsOfClientValues(sourceFiles(path.join(root, "app")))).toEqual([]);
  });

  it("finds the directive after leading block and line comments", () => {
    expect(isClientModule('/* licence */\n// note\n"use client";\nexport const A = 1;\n')).toBe(true);
    expect(isClientModule("// note\n/* a */ /* b */\n'use client';\n")).toBe(true);
    expect(isClientModule('/* licence */\nimport x from "y";\n"use client";\n')).toBe(false);
    expect(isClientModule("/*" + "*//*".repeat(10_000))).toBe(false);
  });

  it("flags a server page that calls a helper from a client module", () => {
    const dir = fs.mkdtempSync(path.join(root, "tests", ".boundary-"));
    try {
      fs.writeFileSync(path.join(dir, "Panel.tsx"), '"use client";\nexport const PURPOSE = "x";\nexport function label() { return "y"; }\nexport function Panel() { return null; }\n');
      fs.writeFileSync(path.join(dir, "page.tsx"), 'import { PURPOSE, Panel, label, type Props } from "./Panel";\nexport default function Page() { return label() + PURPOSE; }\n');
      expect(serverImportsOfClientValues([path.join(dir, "page.tsx")]).map((line) => line.split(" imports ")[1])).toEqual([
        'PURPOSE from "use client" ./Panel',
        'label from "use client" ./Panel',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
