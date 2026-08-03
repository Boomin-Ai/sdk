/**
 * @boomin/sdk error hierarchy.
 *
 * Every non-2xx API response is raised as a subclass of BoominError. The
 * subclass is chosen first by the typed `code` in the error body (mirroring
 * the server-side BoominErrorCode registry), then by HTTP status.
 */

export class BoominError extends Error {
  constructor(message, details = {}) {
    super(message || details.code || "Unknown Boomin error");
    this.name = new.target.name;
    /** Typed BoominErrorCode (server registry) or null. */
    this.code = details.code ?? null;
    /** HTTP status of the response, or null for pre-flight/connection errors. */
    this.status = details.status ?? null;
    /** Request id echoed by the API (Request-Id header / error.request_id). */
    this.requestId = details.requestId ?? null;
    /** Offending parameter, when the API names one. */
    this.param = details.param ?? null;
    /**
     * Raw `error` object from the response body, when one was parseable.
     *
     * Deliberately NOT camelCased: `raw` means raw. Every field worth reading is
     * already lifted onto this error as a camelCase property (`code`, `status`,
     * `requestId`, `param`).
     */
    this.raw = details.raw ?? null;
    if (details.cause !== undefined) this.cause = details.cause;
  }
}

export class AuthenticationError extends BoominError {}
export class PermissionError extends BoominError {}
export class InvalidRequestError extends BoominError {}
export class RateLimitError extends BoominError {}
export class ConflictError extends BoominError {}
export class APIError extends BoominError {}

/**
 * Distinctly surfaced typed codes (spec §SDK): a live operation already holds
 * the subject's concurrency slot / gate.
 */
export class OperationConflictError extends ConflictError {}

/** Distinctly surfaced typed code: the billing band's partner limit is hit. */
export class BandLimitReachedError extends InvalidRequestError {}

/** Distinctly surfaced typed code: a funded action is waiting on wallet funds. */
export class FundingRequiredError extends InvalidRequestError {}

/**
 * Raised CLIENT-SIDE, before any request goes out, when a params object spells
 * the same API field two ways — `{ enabledEvents: A, enabled_events: B }`.
 *
 * Silently preferring one would repeat the exact defect this SDK's casing work
 * exists to eliminate: ambiguous caller intent resolved out of sight. Explicit
 * snake_case wins only when it is the SOLE spelling supplied.
 *
 * It extends InvalidRequestError on purpose: an existing
 * `catch (e) { if (e instanceof InvalidRequestError) ... }` keeps working, and
 * `e.code === "conflicting_parameters"` names the precise fault — the same
 * pattern BandLimitReachedError and FundingRequiredError already use. `status`
 * stays null because no HTTP request was ever made.
 */
export class ConflictingParametersError extends InvalidRequestError {
  constructor(message, details = {}) {
    super(message, { code: "conflicting_parameters", ...details });
    /** The camelCase spelling that collided. */
    this.param = details.param ?? null;
    /** Its snake_case twin, at the same path. */
    this.conflictsWith = details.conflictsWith ?? null;
  }
}

/** Webhook signature verification failure (constructEvent). */
export class WebhookSignatureVerificationError extends BoominError {
  constructor(message, details = {}) {
    super(message, { code: "webhook_signature_invalid", ...details });
    /** The signature header that failed verification. */
    this.sigHeader = details.sigHeader ?? null;
    /** The raw payload that failed verification. */
    this.payload = details.payload ?? null;
  }
}

const CODE_CLASS_MAP = {
  operation_conflict: OperationConflictError,
  cancellation_in_progress: OperationConflictError,
  band_limit_reached: BandLimitReachedError,
  funding_required: FundingRequiredError,
};

const STATUS_CLASS_MAP = {
  400: InvalidRequestError,
  402: InvalidRequestError,
  404: InvalidRequestError,
  422: InvalidRequestError,
  401: AuthenticationError,
  403: PermissionError,
  409: ConflictError,
  429: RateLimitError,
};

/**
 * Build the correct BoominError subclass for a non-2xx API response.
 *
 * @param {number} status HTTP status code.
 * @param {unknown} body Parsed response body (may be null/undefined).
 * @param {string | null} requestId Request id from headers, if any.
 * @returns {BoominError}
 */
export function errorFromResponse(status, body, requestId) {
  const err =
    body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : null;
  const code = typeof err?.code === "string" ? err.code : null;
  const message =
    (typeof err?.message === "string" && err.message) ||
    `Boomin API request failed with status ${status}`;
  const Klass =
    (code && CODE_CLASS_MAP[code]) ||
    STATUS_CLASS_MAP[status] ||
    APIError;
  return new Klass(message, {
    code,
    status,
    requestId: requestId ?? (typeof err?.request_id === "string" ? err.request_id : null),
    param: typeof err?.param === "string" ? err.param : null,
    raw: err,
  });
}
