import { Temporal } from "@js-temporal/polyfill";

import {
  normalizePublicTrustEvidence,
  PUBLIC_TRUST_CHECK_IDS,
  PUBLIC_TRUST_CHECKS,
  type CurrentPublicTrustDeployment,
  type PublicTrustEvidenceSnapshot,
  type PublicTrustStatus,
} from "@/lib/resolvers/public-trust-evidence.resolver";

const DEFAULT_FEED_URL =
  "https://emixd12.github.io/cadence/trust/latest.json";
const MAX_FEED_BYTES = 256_000;

export const PUBLIC_TRUST_CHECK_LABELS = {
  source_to_deployment_provenance: "Source to deployment provenance",
  production_dependency_vulnerabilities: "Production dependency scanning",
  code_scanning: "Code scanning",
  secret_scanning: "Secret scanning",
  public_artifact_integrity: "Public artifact integrity",
  application_live_route_comparison: "Application routes",
  marketing_live_route_comparison: "Marketing routes",
  hosted_migration_boundary: "Hosted migration boundary",
  cross_account_rls_isolation: "Cross-account RLS isolation",
} as const;

export type PublicTrustView = {
  schema: "cadence.public-trust-view";
  schema_version: 1;
  feed_state: "live" | "cached_stale" | "unavailable";
  feed_message: string | null;
  snapshot: {
    id: string;
    url: string;
    source_commit: string;
    application_deployment_id: string;
    application_deployment_url: string;
    marketing_deployment_id: string;
    marketing_deployment_url: string;
    workflow_url: string;
    built_at: string;
    verified_at: string;
    freshness_deadline: string;
  } | null;
  checks: Array<{
    id: keyof typeof PUBLIC_TRUST_CHECK_LABELS;
    label: string;
    status: PublicTrustStatus;
    scope: string;
    scope_limit: string;
    summary: string;
    unavailable_reason: string | null;
    completed_at: string | null;
    freshness_deadline: string | null;
    evidence_url: string | null;
  }>;
};

let lastValidatedSnapshot: PublicTrustEvidenceSnapshot | null = null;

function currentDeployment(): CurrentPublicTrustDeployment {
  return {
    source_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    application_deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
    marketing_deployment_id:
      process.env.CADENCE_TRUST_MARKETING_DEPLOYMENT_ID ?? "unknown",
  };
}

function toView(
  snapshot: PublicTrustEvidenceSnapshot,
  feedState: PublicTrustView["feed_state"],
  feedMessage: string | null,
): PublicTrustView {
  return {
    schema: "cadence.public-trust-view",
    schema_version: 1,
    feed_state: feedState,
    feed_message: feedMessage,
    snapshot: {
      id: snapshot.snapshot_id,
      url: snapshot.snapshot_url,
      source_commit: snapshot.source_commit,
      application_deployment_id: snapshot.application_deployment.id,
      application_deployment_url: snapshot.application_deployment.url,
      marketing_deployment_id: snapshot.marketing_deployment.id,
      marketing_deployment_url: snapshot.marketing_deployment.url,
      workflow_url: snapshot.workflow_run.url,
      built_at: snapshot.built_at,
      verified_at: snapshot.verified_at,
      freshness_deadline: snapshot.freshness_deadline,
    },
    checks: snapshot.checks.map((check) => ({
      id: check.id,
      label: PUBLIC_TRUST_CHECK_LABELS[check.id],
      status:
        feedState === "cached_stale" && check.status === "passed"
          ? "stale"
          : check.status,
      scope: check.scope,
      scope_limit: check.scope_limit,
      summary: check.summary,
      unavailable_reason: check.unavailable_reason,
      completed_at: check.completed_at,
      freshness_deadline: check.freshness_deadline,
      evidence_url: check.evidence_url,
    })),
  };
}

function unavailableView(message: string): PublicTrustView {
  return {
    schema: "cadence.public-trust-view",
    schema_version: 1,
    feed_state: "unavailable",
    feed_message: message,
    snapshot: null,
    checks: PUBLIC_TRUST_CHECK_IDS.map((id) => ({
      id,
      label: PUBLIC_TRUST_CHECK_LABELS[id],
      status: "unavailable",
      scope: PUBLIC_TRUST_CHECKS[id].meaning,
      scope_limit: PUBLIC_TRUST_CHECKS[id].scopeLimit,
      summary: "No validated public evidence is available.",
      unavailable_reason: message,
      completed_at: null,
      freshness_deadline: null,
      evidence_url: null,
    })),
  };
}

export async function getPublicTrustEvidence(options: {
  fetcher?: typeof fetch;
  now?: Temporal.Instant;
  current?: CurrentPublicTrustDeployment;
} = {}): Promise<PublicTrustView> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Temporal.Now.instant();
  const current = options.current ?? currentDeployment();

  try {
    const response = await fetcher(
      DEFAULT_FEED_URL,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) throw new Error("The evidence host did not return a valid response.");
    const body = await response.text();
    if (body.length > MAX_FEED_BYTES) throw new Error("The evidence response exceeded its public size limit.");
    const normalized = normalizePublicTrustEvidence(JSON.parse(body), now, current);
    if (!normalized.ok) throw new Error("The evidence host returned an invalid snapshot.");
    lastValidatedSnapshot = normalized.value;
    return toView(normalized.value, "live", null);
  } catch {
    if (lastValidatedSnapshot) {
      const normalized = normalizePublicTrustEvidence(lastValidatedSnapshot, now, current);
      if (normalized.ok) {
        return toView(
          normalized.value,
          "cached_stale",
          "The evidence host is unavailable. Showing the last validated cached snapshot as Stale.",
        );
      }
    }
    return unavailableView(
      "The evidence host is unavailable and this runtime has no validated cached snapshot.",
    );
  }
}

export function clearPublicTrustEvidenceCacheForTests() {
  lastValidatedSnapshot = null;
}
