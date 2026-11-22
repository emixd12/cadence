import path from "node:path";
import { describe, expect, it } from "vitest";
import { supabaseCliEnv } from "../scripts/supabase-cli.mjs";

const packageDir = "/repo/node_modules/@supabase/cli-darwin-arm64";
const goBinary = path.join(packageDir, "bin", "supabase-go");
const resolvePackageDir = (name: string) => {
  if (name !== "@supabase/cli-darwin-arm64") throw new Error(`unexpected ${name}`);
  return packageDir;
};

describe("supabaseCliEnv", () => {
  it("points darwin/arm64 at supabase-go when no override is set", () => {
    for (const value of [undefined, ""]) {
      const env = supabaseCliEnv({
        platform: "darwin",
        arch: "arm64",
        env: { PATH: "/bin", SUPABASE_CLI_BINARY_OVERRIDE: value },
        resolvePackageDir,
        fileExists: (file) => file === goBinary,
      });
      expect(env.SUPABASE_CLI_BINARY_OVERRIDE).toBe(goBinary);
      expect(env.PATH).toBe("/bin");
    }
  });

  it("keeps a caller-supplied override", () => {
    const caller = "/repo/node_modules/@supabase/cli-linux-x64/bin/supabase-go";
    const env = supabaseCliEnv({
      platform: "darwin",
      arch: "arm64",
      env: { SUPABASE_CLI_BINARY_OVERRIDE: caller },
      resolvePackageDir,
      fileExists: () => true,
    });
    expect(env.SUPABASE_CLI_BINARY_OVERRIDE).toBe(caller);
  });

  it("leaves other platforms to the upstream launcher", () => {
    for (const [platform, arch] of [["linux", "x64"], ["darwin", "x64"], ["linux", "arm64"]]) {
      const env = supabaseCliEnv({ platform, arch, env: {}, resolvePackageDir, fileExists: () => true });
      expect(env.SUPABASE_CLI_BINARY_OVERRIDE).toBeUndefined();
    }
  });

  it("falls back when the darwin package or supabase-go is missing", () => {
    const missingPackage = supabaseCliEnv({
      platform: "darwin",
      arch: "arm64",
      env: {},
      resolvePackageDir: () => {
        throw new Error("not installed");
      },
    });
    expect(missingPackage.SUPABASE_CLI_BINARY_OVERRIDE).toBeUndefined();
    const missingBinary = supabaseCliEnv({
      platform: "darwin",
      arch: "arm64",
      env: {},
      resolvePackageDir,
      fileExists: () => false,
    });
    expect(missingBinary.SUPABASE_CLI_BINARY_OVERRIDE).toBeUndefined();
  });
});
