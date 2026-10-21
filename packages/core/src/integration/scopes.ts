/** OAuth scopes a Cadence integration grant can carry. */
export const INTEGRATION_SCOPES = Object.freeze({
  read: "cadence.read",
  occurrencesWrite: "cadence.occurrences.write",
  behaviorsWrite: "cadence.behaviors.write",
} as const);

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[keyof typeof INTEGRATION_SCOPES];

/** Display order for consent screens, discovery documents, and docs. */
export const INTEGRATION_SCOPE_LIST: readonly IntegrationScope[] = Object.freeze([
  INTEGRATION_SCOPES.read,
  INTEGRATION_SCOPES.occurrencesWrite,
  INTEGRATION_SCOPES.behaviorsWrite,
]);

export type IntegrationScopeDefinition = {
  scope: IntegrationScope;
  required: boolean;
  summary: string;
};

export const INTEGRATION_SCOPE_DEFINITIONS: readonly IntegrationScopeDefinition[] = Object.freeze([
  {
    scope: INTEGRATION_SCOPES.read,
    required: true,
    summary: "Read Behaviors, categories, Occurrences, statuses, notes, time sessions, adherence, and the profile timezone.",
  },
  {
    scope: INTEGRATION_SCOPES.occurrencesWrite,
    required: false,
    summary: "Mark Occurrences Completed, Not Completed, or Unresolved, and edit Occurrence notes.",
  },
  {
    scope: INTEGRATION_SCOPES.behaviorsWrite,
    required: false,
    summary: "Create and edit Behaviors, and archive or restore them. Nothing is deleted.",
  },
].map((definition) => Object.freeze(definition as IntegrationScopeDefinition)));

export function isIntegrationScope(value: unknown): value is IntegrationScope {
  return typeof value === "string" && (INTEGRATION_SCOPE_LIST as readonly string[]).includes(value);
}
