import { INTEGRATION_CONTRACT_VERSION } from "./version";
import { INTEGRATION_LIMITS } from "./limits";
import { INTEGRATION_SCOPE_LIST, type IntegrationScope } from "./scopes";
import { array, boolean, enumOf, integer, literal, nullable, object, optional, root, string, type Infer } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * What a client should do before retrying.
 * - `never`: retrying the same call cannot succeed.
 * - `after_change`: change the input, then call again.
 * - `after_refresh`: read the record again, then retry with current values.
 * - `after_delay`: retry the same call later (honor `retry_after_seconds`).
 * - `after_authorization`: reconnect or grant the missing permission first.
 */
export const INTEGRATION_RETRY_GUIDANCE = ["never", "after_change", "after_refresh", "after_delay", "after_authorization"] as const;
export type IntegrationRetryGuidance = (typeof INTEGRATION_RETRY_GUIDANCE)[number];

export type IntegrationErrorDefinition = {
  code: string;
  httpStatus: number;
  retryable: boolean;
  retry: IntegrationRetryGuidance;
  meaning: string;
};

function define<const C extends string>(
  code: C,
  httpStatus: number,
  retry: IntegrationRetryGuidance,
  meaning: string,
): IntegrationErrorDefinition & { code: C } {
  return Object.freeze({ code, httpStatus, retryable: retry !== "never", retry, meaning });
}

/** Stable error codes. Codes are never renamed; new codes are a minor version change. */
export const INTEGRATION_ERRORS = Object.freeze([
  define("invalid_input", 400, "after_change", "The input does not match the tool's schema or rules. `field_errors` names each problem."),
  define("limit_exceeded", 400, "after_change", "The request asks for more than a contract limit allows, such as too long a date range or too large a result. Narrow the request."),
  define("not_found", 404, "never", "No record with that id exists for this account."),
  define("conflict", 409, "after_refresh", "The record changed since it was read: `expected_status` or `expected_revision` is stale. Nothing changed."),
  define("idempotency_key_reused", 409, "after_change", "The `idempotency_key` was already used with a different input. Use a new key for a new request."),
  define("invalid_state", 409, "after_refresh", "The record's current state does not allow this change."),
  define("authentication_required", 401, "after_authorization", "The access token is missing, expired, revoked, or issued for another resource. Reconnect Cadence."),
  define("insufficient_scope", 403, "after_authorization", "The connection does not include the permission this tool needs. `required_scopes` lists it."),
  define("rate_limited", 429, "after_delay", "Too many requests for this connection. Retry after `retry_after_seconds`."),
  define("service_unavailable", 503, "after_delay", "Cadence integrations are temporarily unavailable."),
  define("internal_error", 500, "after_delay", "Cadence could not complete the request. Nothing is assumed to have changed; retry once with the same `idempotency_key`."),
] as const);

export type IntegrationErrorCode = (typeof INTEGRATION_ERRORS)[number]["code"];

export const INTEGRATION_ERROR_CODES: readonly IntegrationErrorCode[] = Object.freeze(
  INTEGRATION_ERRORS.map((definition) => definition.code),
);

export function getIntegrationErrorDefinition(code: IntegrationErrorCode): IntegrationErrorDefinition {
  const definition = INTEGRATION_ERRORS.find((candidate) => candidate.code === code);
  if (!definition) throw new Error(`Unknown integration error code: ${code}`);
  return definition;
}

const fieldErrorSchema = object({
  path: string({ maxLength: 300, description: "Location of the problem in the input, for example `$.schedules[0].time_entries`." }),
  message: string({ maxLength: 300 }),
});

export const integrationErrorSchema = root(object({
  code: enumOf(INTEGRATION_ERROR_CODES, { description: "Stable error code." }),
  message: string({ minLength: 1, maxLength: 500, description: "Actionable explanation in plain language." }),
  retryable: boolean({ description: "False only when retrying cannot succeed." }),
  retry: enumOf(INTEGRATION_RETRY_GUIDANCE, { description: "What to do before retrying." }),
  retry_after_seconds: optional(nullable(integer({ minimum: 0, maximum: 86_400 }))),
  required_scopes: optional(array(enumOf(INTEGRATION_SCOPE_LIST), { minItems: 1, maxItems: INTEGRATION_SCOPE_LIST.length, uniqueItems: true })),
  field_errors: optional(array(fieldErrorSchema, { maxItems: 50 })),
  contract_version: literal(INTEGRATION_CONTRACT_VERSION),
}, { description: "Error returned by every Cadence integration tool." }));

export type IntegrationError = Infer<typeof integrationErrorSchema>;

export type IntegrationErrorOptions = {
  retryAfterSeconds?: number | null;
  requiredScopes?: IntegrationScope[];
  fieldErrors?: { path: string; message: string }[];
};

export function createIntegrationError(
  code: IntegrationErrorCode,
  message: string,
  options: IntegrationErrorOptions = {},
): IntegrationError {
  const definition = getIntegrationErrorDefinition(code);
  const error: IntegrationError = {
    code,
    message: truncate(message, 500),
    retryable: definition.retryable,
    retry: definition.retry,
    contract_version: INTEGRATION_CONTRACT_VERSION,
  };
  if (options.retryAfterSeconds !== undefined) error.retry_after_seconds = options.retryAfterSeconds;
  if (options.requiredScopes?.length) error.required_scopes = [...new Set(options.requiredScopes)];
  if (options.fieldErrors?.length) {
    error.field_errors = options.fieldErrors.slice(0, 50).map((fieldError) => ({
      path: truncate(fieldError.path, 300),
      message: truncate(fieldError.message, 300),
    }));
  }
  return error;
}

export function invalidInputError(issues: readonly ValidationIssue[]): IntegrationError {
  const first = issues[0];
  const summary = first ? `${first.path} ${first.message}.` : "The input is invalid.";
  return createIntegrationError("invalid_input", `Check the input: ${summary}`, {
    fieldErrors: issues.map((issue) => ({ path: issue.path, message: issue.message })),
  });
}

export function insufficientScopeError(requiredScope: IntegrationScope, toolName: string): IntegrationError {
  return createIntegrationError(
    "insufficient_scope",
    `${toolName} needs the ${requiredScope} permission. Reconnect Cadence and allow it on the consent screen.`,
    { requiredScopes: [requiredScope] },
  );
}

export function responseTooLargeError(): IntegrationError {
  return createIntegrationError(
    "limit_exceeded",
    `The result is larger than ${INTEGRATION_LIMITS.maxResponseBytes} bytes. Use a smaller page size or a shorter date range.`,
  );
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum ? value : `${characters.slice(0, maximum - 1).join("")}…`;
}
