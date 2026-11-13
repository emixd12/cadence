import { SIGN_IN_METHODS_ROUTE } from "@/lib/auth/desktop-sign-in";
import { EMAIL_SIGN_IN_CODE_LENGTH } from "@/lib/auth/email-sign-in";

// Ticket 336 (D31.2): the methods the hosted app reports as on. Google has no flag, so a
// Mac that cannot read the list still offers Google and nothing else.
export type DesktopSignInMethodId = "google" | "apple" | "email";
export type DesktopSignInMethod = Readonly<{ id: DesktopSignInMethodId; label: string }>;
export type DesktopSignInMethods = Readonly<{ methods: readonly DesktopSignInMethod[]; emailCodeLength: number }>;
export const GOOGLE_ONLY_SIGN_IN: DesktopSignInMethods = {
  methods: [{ id: "google", label: "Continue with Google" }], emailCodeLength: EMAIL_SIGN_IN_CODE_LENGTH,
};

export function parseDesktopSignInMethods(value: unknown): DesktopSignInMethods {
  if (!value || typeof value !== "object") return GOOGLE_ONLY_SIGN_IN;
  const { methods, emailCodeLength } = value as { methods?: unknown; emailCodeLength?: unknown };
  if (!Array.isArray(methods)) return GOOGLE_ONLY_SIGN_IN;
  const known: DesktopSignInMethod[] = [];
  for (const method of methods) {
    const id = (method as { id?: unknown })?.id, label = (method as { label?: unknown })?.label;
    // A code length this build cannot accept hides email rather than offering a broken form.
    if (id === "email" && emailCodeLength !== EMAIL_SIGN_IN_CODE_LENGTH) continue;
    if ((id === "google" || id === "apple" || id === "email") && typeof label === "string" && label.length <= 60
      && !known.some((entry) => entry.id === id)) known.push({ id, label });
  }
  return known.length ? { methods: known, emailCodeLength: EMAIL_SIGN_IN_CODE_LENGTH } : GOOGLE_ONLY_SIGN_IN;
}

export async function fetchDesktopSignInMethods(origin: string | null, fetcher: typeof fetch = fetch): Promise<DesktopSignInMethods> {
  if (!origin) return GOOGLE_ONLY_SIGN_IN;
  try {
    const response = await fetcher(`${origin}${SIGN_IN_METHODS_ROUTE}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return response.ok ? parseDesktopSignInMethods(await response.json()) : GOOGLE_ONLY_SIGN_IN;
  } catch { return GOOGLE_ONLY_SIGN_IN; }
}
