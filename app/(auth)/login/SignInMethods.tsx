import { LogIn, Mail, type LucideIcon } from "lucide-react";

import {
  signInStartHref,
  type SignInMethod,
  type SignInMethodId,
} from "@/lib/auth/sign-in-methods";

const ICONS: Partial<Record<SignInMethodId, LucideIcon>> = {
  email: Mail,
};

const CONTROL_CLASS =
  "product-action product-action-primary min-h-11 py-2 text-base font-bold";

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
      />
    );
  }

  return (
    <ul className="grid list-none justify-items-start">
      {methods.map((method) => (
        <li key={method.id}>
          <SignInMethodControl
            disabled={disabled}
            method={method}
            nextPath={nextPath}
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
}: Readonly<{
  disabled: boolean;
  method: SignInMethod;
  nextPath: string;
}>) {
  const Icon = ICONS[method.id] ?? LogIn;
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
      <button type="button" disabled className={CONTROL_CLASS}>
        {content}
      </button>
    );
  }

  return (
    <a href={signInStartHref(method, nextPath)} className={CONTROL_CLASS}>
      {content}
    </a>
  );
}
