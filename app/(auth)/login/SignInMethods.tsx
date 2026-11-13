import { LogIn, Mail, type LucideIcon } from "lucide-react";

import {
  signInStartHref,
  type SignInMethod,
  type SignInMethodId,
} from "@/lib/auth/sign-in-methods";

const ICONS: Partial<Record<SignInMethodId, LucideIcon>> = {
  email: Mail,
};

const TEXT_ACTION_CLASS = "product-action min-h-11 py-2 text-base font-bold";

// Ticket 333 (L-024): Apple's custom-button rules, styled in app/globals.css.
// Black fill on a light page, white logo and title, rectangular, at least 140 px
// wide and no smaller than the other sign-in actions. The logo file's height
// equals the button's height, and the title is 43% of it (19 px at 44 px).
const APPLE_CLASS = "apple-sign-in-action";

type SignInMethodsProps = Readonly<{
  disabled?: boolean;
  methods: readonly SignInMethod[];
  nextPath: string;
}>;

export function SignInMethods({
  disabled = false,
  methods,
  nextPath,
}: SignInMethodsProps) {
  if (methods.length === 0) return null;

  if (methods.length === 1) {
    return (
      <SignInMethodControl
        disabled={disabled}
        method={methods[0]}
        nextPath={nextPath}
        secondary={false}
      />
    );
  }

  // The first method is the primary action; email follows as a secondary one.
  return (
    <ul className="grid list-none justify-items-start gap-2">
      {methods.map((method, index) => (
        <li key={method.id}>
          <SignInMethodControl
            disabled={disabled}
            method={method}
            nextPath={nextPath}
            secondary={index > 0 && method.id === "email"}
          />
        </li>
      ))}
    </ul>
  );
}

function SignInMethodControl({
  disabled,
  method,
  nextPath,
  secondary,
}: Readonly<{
  disabled: boolean;
  method: SignInMethod;
  nextPath: string;
  secondary: boolean;
}>) {
  const href = signInStartHref(method, nextPath);

  if (method.id === "apple") {
    const content = (
      <>
        <AppleLogo />
        {method.label}
      </>
    );
    return disabled ? (
      <button type="button" disabled className={APPLE_CLASS}>
        {content}
      </button>
    ) : (
      <a href={href} className={APPLE_CLASS}>
        {content}
      </a>
    );
  }

  const Icon = ICONS[method.id] ?? LogIn;
  const className = `${TEXT_ACTION_CLASS} ${
    secondary ? "product-action-secondary" : "product-action-primary"
  }`;
  const content = (
    <>
      <Icon
        aria-hidden="true"
        className="shrink-0"
        size="1em"
        strokeWidth={1.5}
      />
      {method.label}
    </>
  );

  if (disabled) {
    return (
      <button type="button" disabled className={className}>
        {content}
      </button>
    );
  }

  return (
    <a href={href} className={className}>
      {content}
    </a>
  );
}

// Apple Design Resources, "Logo - SIWA - Left-aligned - White - Medium" (31 x 44),
// downloaded November 13, 2026; background rectangle removed, glyph unchanged.
// L-024 records the licence question.
function AppleLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-11 w-[31px] shrink-0"
      focusable="false"
      viewBox="0 0 31 44"
    >
      <path
        fill="currentColor"
        d="M15.7099491,14.8846154 C16.5675461,14.8846154 17.642562,14.3048315 18.28274,13.5317864 C18.8625238,12.8312142 19.2852829,11.852829 19.2852829,10.8744437 C19.2852829,10.7415766 19.2732041,10.6087095 19.2490464,10.5 C18.2948188,10.5362365 17.1473299,11.140178 16.4588366,11.9494596 C15.9152893,12.56548 15.4200572,13.5317864 15.4200572,14.5222505 C15.4200572,14.6671964 15.4442149,14.8121424 15.4562937,14.8604577 C15.5166879,14.8725366 15.6133185,14.8846154 15.7099491,14.8846154 Z M12.6902416,29.5 C13.8618881,29.5 14.3812778,28.714876 15.8428163,28.714876 C17.3285124,28.714876 17.6546408,29.4758423 18.9591545,29.4758423 C20.2395105,29.4758423 21.0971074,28.292117 21.9063891,27.1325493 C22.8123013,25.8038779 23.1867451,24.4993643 23.2109027,24.4389701 C23.1263509,24.4148125 20.6743484,23.4122695 20.6743484,20.5979021 C20.6743484,18.1579784 22.6069612,17.0588048 22.7156707,16.974253 C21.4353147,15.1382708 19.490623,15.0899555 18.9591545,15.0899555 C17.5217737,15.0899555 16.3501271,15.9596313 15.6133185,15.9596313 C14.8161157,15.9596313 13.7652575,15.1382708 12.521138,15.1382708 C10.1536872,15.1382708 7.75,17.0950413 7.75,20.7911634 C7.75,23.0861411 8.64383344,25.513986 9.74300699,27.0842339 C10.6851558,28.4129053 11.5065162,29.5 12.6902416,29.5 Z"
      />
    </svg>
  );
}
