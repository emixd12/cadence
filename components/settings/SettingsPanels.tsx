"use client";

import type { ReactNode } from "react";

import { LEGAL_PAGE_ORDER, LEGAL_PAGES } from "@/components/settings/LegalContent";
import { SettingsHeadingScope, useSettingsHeading, type SettingsHeadingLevel } from "@/components/settings/settings-heading";

type SettingsPanelProps = Readonly<{
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * Level 3 is for a source nested inside the connector library. Omit it to follow
   * the surrounding group, row or drawer. `null` renders no heading: the row or
   * drawer around the panel shows the title instead (Ticket 301).
   */
  headingLevel?: SettingsHeadingLevel | null;
}>;

export function SettingsPanel({
  id,
  title,
  description,
  children,
  className = "",
  headingLevel,
}: SettingsPanelProps) {
  const heading = useSettingsHeading(headingLevel);
  const nested = headingLevel === 3 || heading.level >= 4;
  return (
    <section
      id={id}
      className={["bg-background py-4 first:pt-0 last:pb-0", className]
        .filter(Boolean)
        .join(" ")}
    >
      {heading.show ? <heading.Tag className={nested ? "text-lg font-bold leading-tight" : "text-xl leading-tight"}>{title}</heading.Tag> : null}
      {description ? (
        <p className={[heading.show ? "mt-3" : "", "max-w-2xl text-sm leading-6 text-muted-readable"].filter(Boolean).join(" ")}>
          {description}
        </p>
      ) : null}
      <div className={heading.show || description ? "mt-4" : ""}>
        <SettingsHeadingScope level={heading.childLevel}>{children}</SettingsHeadingScope>
      </div>
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
