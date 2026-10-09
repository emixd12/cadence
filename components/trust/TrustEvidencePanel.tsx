import type { PublicTrustView } from "@/lib/services/public-trust-evidence.service";

const STATUS_LABELS = { passed: "Passed", failed: "Failed", stale: "Stale", not_run: "Not run", unavailable: "Unavailable" } as const;

const CHECK_GROUPS = [
  { title: "Build and supply chain", ids: ["source_to_deployment_provenance", "production_dependency_vulnerabilities", "code_scanning", "secret_scanning"] },
  { title: "Public route integrity", ids: ["public_artifact_integrity", "application_live_route_comparison", "marketing_live_route_comparison"] },
  { title: "Hosted data boundaries", ids: ["hosted_migration_boundary", "cross_account_rls_isolation"] },
] as const;

const DEPENDENCIES = [
  ["Vercel", "Application and marketing hosting", "Receives deployment and request data."],
  ["Supabase", "Postgres storage and authentication", "Stores account and behavior records behind Row Level Security."],
  ["Google Auth", "Google account sign-in", "Provides the identity used by Supabase Auth."],
  ["Browser push", "Browser reminders", "Optional; depends on browser permission and a push subscription."],
  ["Sequenzy", "Email reminders", "Optional; used only when email reminders are enabled."],
] as const;

function formatTimestamp(value: string | null) {
  return value ? `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC` : "Not available";
}

export function TrustEvidencePanel({ evidence }: { evidence: PublicTrustView }) {
  return (
    <section aria-labelledby="trust-evidence-title" className="border-b border-line pb-6">
      <h2 id="trust-evidence-title" className="text-2xl leading-tight">Current verification results</h2>
      <p className="mt-4 max-w-3xl text-base leading-7 text-muted-readable">These checks are bounded, time-specific evidence. They do not certify Cadence or prove that defects are absent.</p>
      {evidence.feed_message ? <p role="status" className="mt-4 border-l-2 border-accent pl-3 text-sm leading-6">{evidence.feed_message}</p> : null}

      {evidence.snapshot ? (
        <section aria-labelledby="deployment-summary-title" className="mt-6">
          <h3 id="deployment-summary-title" className="text-xl">Deployment summary</h3>
          <dl className="mt-4 grid gap-x-6 gap-y-3 border-y border-line py-4 text-sm leading-6 sm:grid-cols-2">
            <div><dt className="text-muted-readable">Source commit</dt><dd className="break-all font-mono">{evidence.snapshot.source_commit}</dd></div>
            <div><dt className="text-muted-readable">Application deployment</dt><dd><a className="product-action product-action-secondary break-all" href={evidence.snapshot.application_deployment_url} rel="noreferrer">{evidence.snapshot.application_deployment_id}</a></dd></div>
            <div><dt className="text-muted-readable">Marketing deployment</dt><dd><a className="product-action product-action-secondary break-all" href={evidence.snapshot.marketing_deployment_url} rel="noreferrer">{evidence.snapshot.marketing_deployment_id}</a></dd></div>
            <div><dt className="text-muted-readable">Build time</dt><dd>{formatTimestamp(evidence.snapshot.built_at)}</dd></div>
            <div><dt className="text-muted-readable">Verification time</dt><dd>{formatTimestamp(evidence.snapshot.verified_at)}</dd></div>
            <div><dt className="text-muted-readable">Snapshot fresh until</dt><dd>{formatTimestamp(evidence.snapshot.freshness_deadline)}</dd></div>
          </dl>
        </section>
      ) : null}

      <div className="mt-8 grid min-w-0 gap-8 break-words">
        {CHECK_GROUPS.map((group) => {
          const headingId = `trust-${group.title.toLowerCase().replaceAll(" ", "-")}`;
          return (
            <section key={group.title} aria-labelledby={headingId} className="min-w-0">
              <h3 id={headingId} className="text-xl">{group.title}</h3>
              <div className="mt-4 divide-y divide-line border-y border-line">
                {group.ids.map((id) => {
                  const check = evidence.checks.find((item) => item.id === id);
                  if (!check) return null;
                  return (
                    <article key={check.id} className="py-5" data-status={check.status}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                        <h4 className="text-lg leading-6">{check.label}</h4>
                        <p className="text-sm leading-6" aria-label={`Status: ${STATUS_LABELS[check.status]}`}>Status: {STATUS_LABELS[check.status]}</p>
                      </div>
                      <p className="mt-3 max-w-3xl text-sm leading-6">{check.summary}</p>
                      {check.unavailable_reason ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-readable">Reason: {check.unavailable_reason}</p> : null}
                      <dl className="mt-3 grid gap-2 text-sm leading-6 text-muted-readable">
                        <div><dt className="inline text-foreground">Timestamp: </dt><dd className="inline">{formatTimestamp(check.completed_at)}</dd></div>
                        <div><dt className="inline text-foreground">Scope: </dt><dd className="inline">{check.scope}</dd></div>
                        <div><dt className="inline text-foreground">Limit: </dt><dd className="inline">{check.scope_limit}</dd></div>
                      </dl>
                      {check.evidence_url ? <a className="product-action product-action-secondary mt-3 text-sm" href={check.evidence_url} rel="noreferrer">Open immutable evidence for {check.label}</a> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section aria-labelledby="trust-dependencies-title" className="mt-8">
        <h3 id="trust-dependencies-title" className="text-xl">Service dependencies</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm leading-6">
            <thead><tr className="border-y border-line"><th className="py-3 pr-4 font-normal">Service</th><th className="py-3 pr-4 font-normal">Purpose</th><th className="py-3 font-normal">Boundary</th></tr></thead>
            <tbody className="divide-y divide-line">{DEPENDENCIES.map(([service, purpose, boundary]) => <tr key={service}><th scope="row" className="py-3 pr-4 font-normal">{service}</th><td className="py-3 pr-4 text-muted-readable">{purpose}</td><td className="py-3 text-muted-readable">{boundary}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      {evidence.snapshot ? (
        <section aria-labelledby="trust-evidence-links-title" className="mt-8">
          <h3 id="trust-evidence-links-title" className="text-xl">Evidence links</h3>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <a className="product-action product-action-secondary" href={evidence.snapshot.url} rel="noreferrer">Immutable snapshot</a>
            <a className="product-action product-action-secondary" href={evidence.snapshot.workflow_url} rel="noreferrer">Verification workflow</a>
            <a className="product-action product-action-secondary" href="https://github.com/emixd12/cadence" rel="noreferrer">Public source and MIT license</a>
          </div>
        </section>
      ) : null}
    </section>
  );
}
