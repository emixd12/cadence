#!/usr/bin/env node
// `npm run supabase` entry point. On Apple Silicon, @supabase/cli-darwin-arm64@2.105.0
// ships `bin/supabase` with an invalid signature (macOS kills it, exit 137). The same
// package's `bin/supabase-go` is signed correctly, so point the upstream launcher at it.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const OVERRIDE_VARIABLE = "SUPABASE_CLI_BINARY_OVERRIDE";

function defaultResolvePackageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

export function supabaseCliEnv({
  platform = process.platform,
  arch = os.arch(),
  env = process.env,
  resolvePackageDir = defaultResolvePackageDir,
  fileExists = existsSync,
} = {}) {
  if (env[OVERRIDE_VARIABLE]) return env;
  if (platform !== "darwin" || arch !== "arm64") return env;
  let binary;
  try {
    binary = path.join(resolvePackageDir("@supabase/cli-darwin-arm64"), "bin", "supabase-go");
  } catch {
    return env;
  }
  if (!fileExists(binary)) return env;
  return { ...env, [OVERRIDE_VARIABLE]: binary };
}

function main() {
  const launcher = path.join(defaultResolvePackageDir("supabase"), "dist", "supabase.js");
  const result = spawnSync(process.execPath, [launcher, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: supabaseCliEnv(),
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.status ?? 1);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
