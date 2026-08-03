/**
 * Typed error codes mirroring the server-side BoominErrorCode registry
 * (DISTRIBUTION_CORE, frozen 2026-08-01). The union stays open
 * (`string & {}`) so new server codes never break compilation.
 */
export type BoominErrorCode =
  // Distinctly surfaced typed codes (spec §SDK)
  | "operation_conflict"
  | "band_limit_reached"
  | "funding_required"
  // Operations kernel / cancellation taxonomy
  | "cancellation_in_progress"
  | "cancellation_requires_intervention"
  // Capability / rollout gates
  | "channel_type_not_yet_supported"
  | "test_mode_not_yet_available"
  // General request/transport codes
  | "invalid_request"
  | "not_found"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "idempotency_conflict"
  | "internal_error"
  | "connection_error"
  | "request_timeout"
  // SDK-local codes (raised client-side, never seen on the wire)
  | "operation_wait_timeout"
  | "webhook_signature_invalid"
  | "conflicting_parameters"
  | (string & {});

export interface BoominErrorDetails {
  code?: BoominErrorCode | null;
  status?: number | null;
  requestId?: string | null;
  param?: string | null;
  raw?: unknown;
  cause?: unknown;
}

export interface ConflictingParametersDetails extends BoominErrorDetails {
  /** The snake_case twin of `param`, at the same path. */
  conflictsWith?: string | null;
}

/** Base class for every error raised by @boomin/sdk. */
export class BoominError extends Error {
  constructor(message?: string, details?: BoominErrorDetails);
  /** Typed BoominErrorCode from the server registry, when present. */
  readonly code: BoominErrorCode | null;
  /** HTTP status of the failed response; null for connection-level failures. */
  readonly status: number | null;
  /** Request id echoed by the API for support/debugging. */
  readonly requestId: string | null;
  /** Offending parameter, when the API names one. */
  readonly param: string | null;
  /**
   * The raw `error` object from the response body, when parseable.
   * Deliberately NOT camelCased — `code`, `status`, `requestId` and `param`
   * above are the camelCase reading of it.
   */
  readonly raw: unknown;
}

/** 401 — missing/invalid secret key. */
export class AuthenticationError extends BoominError {}
/** 403 — the key's scopes do not permit this call. */
export class PermissionError extends BoominError {}
/** 400/402/404/422 — the request itself is wrong. */
export class InvalidRequestError extends BoominError {}
/** 429 — rate limited; the SDK retries these automatically when idempotent. */
export class RateLimitError extends BoominError {}
/** 409 — the request conflicts with current resource state. */
export class ConflictError extends BoominError {}
/** 5xx and anything unclassified, plus connection errors and timeouts. */
export class APIError extends BoominError {}

/** code `operation_conflict` / `cancellation_in_progress` — a live operation holds the subject. */
export class OperationConflictError extends ConflictError {}
/** code `band_limit_reached` — the billing band's active-partner limit is hit. */
export class BandLimitReachedError extends InvalidRequestError {}
/** code `funding_required` — the action needs wallet funds (operation waits). */
export class FundingRequiredError extends InvalidRequestError {}

/**
 * code `conflicting_parameters` — raised CLIENT-SIDE, before any request goes
 * out, when a params object spells one API field two ways:
 * `{ enabledEvents: A, enabled_events: B }`.
 *
 * Explicit snake_case wins only when it is the SOLE spelling supplied; silently
 * discarding the other would hide ambiguous caller intent, which is the exact
 * defect the SDK's casing work exists to eliminate. `status` is null because no
 * HTTP request was ever made.
 */
export class ConflictingParametersError extends InvalidRequestError {
  constructor(message?: string, details?: ConflictingParametersDetails);
  /** The camelCase spelling that collided, at its full path. */
  readonly param: string | null;
  /** Its snake_case twin, at the same path. */
  readonly conflictsWith: string | null;
}

/** Thrown by `constructEvent` when signature verification fails. */
export class WebhookSignatureVerificationError extends BoominError {
  constructor(message?: string, details?: BoominErrorDetails & { sigHeader?: string | null; payload?: string | null });
  readonly sigHeader: string | null;
  readonly payload: string | null;
}

/** Build the correct BoominError subclass for a non-2xx API response. */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId: string | null,
): BoominError;
