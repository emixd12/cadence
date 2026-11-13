// Ticket 331 (D31): the one list of ways to sign in on the web. The login page
// renders the enabled methods and the start routes accept only those.
// A method is enabled when its flag is exactly "on" (Google has no flag) and its
// `start` is set. Ticket 332 set `start` for email; Ticket 333 sets it for Apple.

export type SignInMethodId = "google" | "apple" | "email";

export type SignInStart =
  | { kind: "oauth"; provider: "google" | "apple" }
  | { kind: "email" };

export type SignInMethod = Readonly<{
  id: SignInMethodId;
  label: string;
  /** Environment variable that turns the method on. `null`: always on. */
  flag: string | null;
  /** `null` until the method's ticket ships; a flag cannot enable it before then. */
  start: SignInStart | null;
  startPath: string;
}>;

export type SignInEnv = Readonly<Record<string, string | undefined>>;

export const SIGN_IN_METHOD_UNAVAILABLE_ERROR = "sign_in_method_unavailable";

export const SIGN_IN_METHODS: readonly SignInMethod[] = [
  {
    id: "google",
    label: "Continue with Google",
    flag: null,
    start: { kind: "oauth", provider: "google" },
    startPath: "/auth/google",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    flag: "CADENCE_SIGN_IN_APPLE",
    start: null,
    startPath: "/auth/sign-in/apple",
  },
  {
    id: "email",
    label: "Continue with email",
    flag: "CADENCE_SIGN_IN_EMAIL",
    start: { kind: "email" },
    startPath: "/auth/sign-in/email",
  },
];

export function enabledSignInMethods(
  env: SignInEnv = process.env,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): SignInMethod[] {
  return methods.filter(
    (method) =>
      method.start !== null &&
      (method.flag === null || env[method.flag] === "on"),
  );
}

export function findEnabledSignInMethod(
  id: string,
  env: SignInEnv = process.env,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): SignInMethod | null {
  return (
    enabledSignInMethods(env, methods).find((method) => method.id === id) ??
    null
  );
}

export function signInStartHref(method: SignInMethod, nextPath: string) {
  return `${method.startPath}?next=${encodeURIComponent(nextPath)}`;
}
