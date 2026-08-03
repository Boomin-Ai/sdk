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
 * code `payout_rules_required` (409) — `payouts.run` on a brand with no active
 * payout rule and no active content split. Nothing could have paid anyone, so
 * this is a CONFIGURATION error, not an empty result: a run that merely found
 * nothing to pay succeeds with `outcome: "no_eligible_activity"`.
 *
 * Distinct class because the two states used to be one silent `count: 0`, and a
 * script that treats "misconfigured" as "nothing owed this month" pays nobody
 * and reports success.
 */
export class PayoutRulesRequiredError extends ConflictError {}

/**
 * codes `payout_rail_required` / `payout_rail_not_configured` /
 * `payout_rail_disabled` — no active rail of the requested kind exists, so
 * nothing can be exported or batched. One class because they are ONE problem
 * from the caller's side, with one fix: configure a rail
 * (`payouts.rails.create`). There is no auto-provisioning — a CSV format is not
 * neutral, and picking one would be picking where the money lands.
 *
 * Extends ConflictError because that is what the v1 tree answers (409); the
 * service-layer `payout_rail_not_configured` is a 404 and keeps its own
 * `status`, so read `status` rather than inferring it from the class.
 */
export class PayoutRailRequiredError extends ConflictError {}

/**
 * code `payout_rail_already_exists` (409) — `payouts.rails.create` is create,
 * NOT upsert. A second create for a configured rail is refused so a call that
 * reads as "add a rail" can never silently rewrite delivery config; say
 * `payouts.rails.update` out loud instead.
 */
export class PayoutRailAlreadyExistsError extends ConflictError {}

/**
 * code `immutable_parameter` (400) — a rule's ECONOMICS are frozen after
 * creation (`type`, `scope`, `metric_key`, `rate_bps`, `per_unit_minor`,
 * `threshold`, `bonus_minor`, `window_*`, `currency`, `revenue_basis`). The
 * payouts ledger references the rule that produced each row, so editing a rate
 * would re-interpret settled history. `param` names the frozen CONCEPT.
 *
 * Fix: create a replacement rule, activate it, then `payouts.rules.archive` the
 * old one — the ledger then names two rules and every row stays explicable.
 */
export class ImmutableParameterError extends InvalidRequestError {}

/**
 * code `payout_batch_empty` (409) — the period held no payout row eligible to
 * be frozen into a batch. Nothing is wrong with the request; there is simply
 * nothing to pay, and no artifact will exist.
 */
export class PayoutBatchEmptyError extends ConflictError {}

/**
 * codes `payout_batch_conflict` / `payout_batch_not_exportable` /
 * `not_confirmable` / `not_cancelable` / `not_disbursable` (409) — the batch
 * exists but its current status does not permit this transition. One class,
 * because the answer is always the same: read the batch
 * (`payouts.batches.retrieve`) and look at `status`. The precise `code` stays
 * on the error for callers that need the specific transition.
 */
export class PayoutBatchStateError extends ConflictError {}

/**
 * Raised CLIENT-SIDE, before any request goes out, when a params object spells
 * the same API field two ways — `{ enabledEvents: A, enabled_events: B }`.
 *
 * Silently preferring one would repeat the exact defect this SDK's casing work
 * exists to eliminate: ambiguous caller intent resolved out of sight. Explicit
 * snake_case wins only when it is the SOLE spelling supplied.
 *
 * The identical rule runs on DESERIALIZATION (`direction: "response"`): a
 * response carrying both spellings of one field is ambiguous, and picking a
 * winner there is the same sin with the server as the author.
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
    /** "request" (nothing was sent) or "response" (the API returned both). */
    this.direction = details.direction ?? "request";
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
  // Payout configuration. A dedicated class exists only where catching the
  // condition is the natural thing to write; `payout_rule_not_found`,
  // `payout_rail_not_found`, `payout_export_format_invalid` and
  // `payout_export_unconfigured` stay on their status-derived classes and are
  // matched by `code`, because there is nothing a caller does differently for
  // them beyond reading the message.
  payout_rules_required: PayoutRulesRequiredError,
  payout_rail_required: PayoutRailRequiredError,
  payout_rail_not_configured: PayoutRailRequiredError,
  payout_rail_disabled: PayoutRailRequiredError,
  payout_rail_already_exists: PayoutRailAlreadyExistsError,
  immutable_parameter: ImmutableParameterError,
  payout_batch_empty: PayoutBatchEmptyError,
  payout_batch_conflict: PayoutBatchStateError,
  payout_batch_not_exportable: PayoutBatchStateError,
  payout_batch_not_confirmable: PayoutBatchStateError,
  payout_batch_not_cancelable: PayoutBatchStateError,
  payout_batch_not_disbursable: PayoutBatchStateError,
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
