import Image from "next/image";
import type { ReactNode } from "react";

// Ticket 332: the email and link pages share the login page's frame.
export function AuthPageShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="min-h-dvh bg-background px-6 pb-16 pt-[22dvh] text-foreground">
      <section className="mx-auto w-full max-w-[22rem]">
        <h1 className="flex items-center gap-3 text-5xl leading-none">
          <Image
            src="/brand/cadence-logo.png"
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 object-contain"
            priority
          />
          <span>Cadence</span>
        </h1>
        {children}
      </section>
    </main>
  );
}
