import type { ReactNode } from "react";

import { LEGAL_PAGE_ORDER, LEGAL_PAGES } from "@/components/settings/LegalContent";

type SettingsPanelProps = Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Level 3 is for a source nested inside the connector library. */
  headingLevel?: 2 | 3;
  id?: string;
}>;

export function SettingsPanel({
  title,
  description,
  children,
  className = "",
  headingLevel = 2,
  id,
}: SettingsPanelProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      className={["bg-background py-4 first:pt-0 last:pb-0", className]
        .filter(Boolean)
        .join(" ")}
    >
      <Heading className={headingLevel === 3 ? "text-lg font-bold leading-tight" : "text-xl leading-tight"}>{title}</Heading>
      {description ? (
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsPanelGrid({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="grid min-w-0 grid-cols-1 divide-y divide-line">
      {children}
    </div>
  );
}

export function SettingsProfile({ email }: Readonly<{ email: string }>) {
  return (
    <SettingsPanel title="Profile">
      <dl className="grid min-w-0 gap-2 text-sm leading-6 text-muted-readable">
        <div className="min-w-0">
          <dt className="font-bold text-foreground">Email</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{email}</dd>
        </div>
      </dl>
    </SettingsPanel>
  );
}

export function TrustAndLegalPanel() {
  return (
    <SettingsPanel
      title="Trust and legal"
      description="Public account, data, and product-boundary information."
    >
      <ul className="grid max-w-fit divide-y divide-line text-sm leading-6">
        {LEGAL_PAGE_ORDER.map((key) => {
          const page = LEGAL_PAGES[key];

          return (
            <li key={key}>
              <a
                href={`/${key}`}
                className="group grid gap-1 px-0 py-3 transition-colors hover:bg-surface sm:grid-cols-[10rem_minmax(0,1fr)]"
              >
                <span className="text-foreground">{page.title}</span>
                <span className="text-muted-readable transition-colors group-hover:text-foreground">{page.summary}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </SettingsPanel>
  );
}
