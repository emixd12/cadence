export const OVERRIDE_VARIABLE: "SUPABASE_CLI_BINARY_OVERRIDE";

export function supabaseCliEnv(options?: {
  platform?: string;
  arch?: string;
  env?: Record<string, string | undefined>;
  resolvePackageDir?: (name: string) => string;
  fileExists?: (file: string) => boolean;
}): Record<string, string | undefined>;
