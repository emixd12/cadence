import { Mail } from "lucide-react";

import { TurnstileField } from "../TurnstileField";

// Ticket 332: the two steps of email sign-in. Plain forms that post to route
// handlers, so they work before JavaScript loads. The design-system bench renders
// them with fixed props.

const PRIMARY_ACTION =
  "product-action product-action-primary min-h-11 justify-self-start py-2 text-base font-bold";
const FIELD =
  "min-h-11 w-full min-w-0 border border-line bg-background px-3 text-base text-foreground";

type StepCommon = Readonly<{
  codeLength: number;
  errorMessage: string | null;
  nextPath: string;
  requestAction: string;
  turnstileSiteKey: string | null;
}>;

function ErrorLine({ message }: Readonly<{ message: string | null }>) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-6 text-sm leading-6 text-accent">
      {message}
    </p>
  );
}

function BotCheck({ siteKey }: Readonly<{ siteKey: string | null }>) {
  return siteKey ? <TurnstileField siteKey={siteKey} /> : null;
}

export function EmailAddressStep({
  codeLength,
  defaultEmail,
  errorMessage,
  loginHref,
  nextPath,
  requestAction,
  turnstileSiteKey,
}: StepCommon &
  Readonly<{
    defaultEmail: string;
    loginHref: string;
  }>) {
  return (
    <>
      <p className="mt-3 text-lg leading-6 text-muted-readable">
        Sign in with email.
      </p>
      <ErrorLine message={errorMessage} />
      <form method="post" action={requestAction} className="mt-6 grid gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <label className="grid gap-1 text-sm leading-6">
          Email
          <input
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            defaultValue={defaultEmail}
            className={FIELD}
          />
        </label>
        <p className="text-sm leading-6 text-muted-readable">
          Cadence emails you a link and a {codeLength}-digit code. A new address
          starts a new account.
        </p>
        <BotCheck siteKey={turnstileSiteKey} />
        <button type="submit" className={PRIMARY_ACTION}>
          <Mail aria-hidden="true" className="shrink-0" size="1em" strokeWidth={1.5} />
          Send sign-in email
        </button>
      </form>
      <a
        href={loginHref}
        className="product-action product-action-secondary mt-6 min-h-10 text-sm"
      >
        Other ways to sign in
      </a>
    </>
  );
}

export function EmailCodeStep({
  changeHref,
  codeLength,
  email,
  errorMessage,
  nextPath,
  requestAction,
  turnstileSiteKey,
  verifyAction,
}: StepCommon &
  Readonly<{
    changeHref: string;
    email: string;
    verifyAction: string;
  }>) {
  return (
    <>
      <p className="mt-3 text-lg leading-6 text-muted-readable">
        Check your email.
      </p>
      <p className="mt-6 text-sm leading-6">
        Cadence sent a sign-in link and a {codeLength}-digit code to{" "}
        <span className="break-all font-bold">{email}</span>. Open the link, or
        enter the code here.
      </p>
      <ErrorLine message={errorMessage} />
      <form method="post" action={verifyAction} className="mt-6 grid gap-4">
        <label className="grid gap-1 text-sm leading-6">
          Code
          <input
            type="text"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={codeLength + 3}
            className={`${FIELD} font-mono text-lg tracking-[0.3em]`}
          />
        </label>
        <button type="submit" className={PRIMARY_ACTION}>
          Sign in
        </button>
      </form>
      <div className="mt-6 grid justify-items-start gap-1 text-sm leading-6">
        <form method="post" action={requestAction} className="grid gap-2">
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="next" value={nextPath} />
          <BotCheck siteKey={turnstileSiteKey} />
          <button
            type="submit"
            className="product-action product-action-secondary min-h-10 justify-self-start"
          >
            Send a new email
          </button>
        </form>
        <a
          href={changeHref}
          className="product-action product-action-secondary min-h-10"
        >
          Use a different email
        </a>
      </div>
    </>
  );
}
