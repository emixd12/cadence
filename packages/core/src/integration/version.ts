/** Version of the Cadence integration operation contract (semantic versioning). */
export const INTEGRATION_CONTRACT_VERSION = "1.0.0" as const;

export type IntegrationContractVersion = typeof INTEGRATION_CONTRACT_VERSION;

export type CompatibilityRule = {
  change: string;
  bump: "patch" | "minor" | "major" | "never";
};

/**
 * How the contract may change. Published tool names never change; a tool can
 * only be removed in a major version after a deprecation period.
 */
export const INTEGRATION_COMPATIBILITY_POLICY: readonly CompatibilityRule[] = Object.freeze([
  { change: "Description, title, or documentation wording that does not change behavior", bump: "patch" },
  { change: "New tool, new optional input field, new output field, or new error code", bump: "minor" },
  { change: "Raised limit, or a relaxed input constraint", bump: "minor" },
  { change: "New required input field, removed or renamed field, changed field type or meaning", bump: "major" },
  { change: "Removed tool, lowered limit, new required scope, or stricter input constraint", bump: "major" },
  { change: "Renaming a published tool", bump: "never" },
].map((rule) => Object.freeze(rule as CompatibilityRule)));

export const INTEGRATION_COMPATIBILITY_NOTES: readonly string[] = Object.freeze([
  "Clients must ignore output fields they do not recognize; minor versions can add them.",
  "Clients must treat unknown error codes by their `retryable` flag.",
  "A tool is deprecated for at least one minor release before a major release removes it.",
]);
