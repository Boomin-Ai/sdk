/**
 * @boomin/sdk — hand-written type surface (no codegen).
 * Object shapes follow DISTRIBUTION_CORE (frozen 2026-08-01).
 */

import type { BoominErrorCode } from "./errors.js";
import type { ConstructEventOptions } from "./webhooks.js";

// ---------------------------------------------------------------------------
// Client plumbing
// ---------------------------------------------------------------------------

export interface BoominOptions {
  /** API origin. Default: `https://api.boomin.ai` (paths live under /v1/platform). */
  baseUrl?: string;
  /** Brand id threaded as the `Boomin-Brand` header on every request. */
  brand?: string;
  /** Max automatic retries on 429/5xx for idempotent requests. Default 2. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** fetch implementation override (testing / exotic runtimes). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /**
   * Idempotency key for this mutation. Auto-generated (crypto.randomUUID)
   * when omitted; pass your own to make cross-process retries idempotent.
   */
  idempotencyKey?: string;
  /** Per-call `Boomin-Brand` override. */
  brand?: string;
  /** Per-call timeout override (ms). */
  timeout?: number;
  /** Per-call retry override. */
  maxRetries?: number;
}

/** One page of a cursor-paginated list. */
export interface List<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/**
 * The return of every list method: awaiting it yields one page; `for await`
 * iterates every item across pages (auto-pagination via starting_after).
 */
export interface ListPromise<T> extends PromiseLike<List<T>>, AsyncIterable<T> {
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<List<T> | R>;
  finally(onFinally?: (() => void) | null): Promise<List<T>>;
}

export interface PaginationParams {
  /** Page size (1-100). */
  limit?: number;
  /** Cursor: return items after this object id. Sent as `starting_after`. */
  startingAfter?: string;
}

/**
 * Params object: known fields are typed, extra fields still compile.
 *
 * Note the v1 API REJECTS body fields it does not recognize (400
 * `invalid_request`, naming the field and the field you probably meant), so an
 * extra key is a runtime error, not a silent no-op. Params are written in
 * camelCase or snake_case; the SDK converts the top level of every body and
 * query string to the snake_case wire form.
 */
type Params<Known = object> = Known & { [key: string]: unknown };

export type Metadata = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Object vocabulary (statuses are text + unions server-side; unions stay open)
// ---------------------------------------------------------------------------

export type PartnershipStatus = "pending" | "active" | "paused" | "ended";
export type EnrollmentApprovalStatus = "pending" | "approved" | "rejected";
export type EnrollmentStatus = "active" | "paused" | "archived";
export type EnrollmentBillingStatus = "none" | "billable" | "exempt";

export type DistributionStatus =
  | "draft"
  | "validating"
  | "ready"
  | "launching"
  | "active"
  | "partially_active"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";
export type DistributionObjective =
  | "awareness"
  | "acquisition"
  | "launch"
  | "conversion"
  | "retention"
  | "event_promotion"
  | "custom"
  | (string & {});
export type ProgramType = "performance" | "upfront";
export type ProgramStatus = "active" | "paused" | "archived";
export type ProgramVisibility = "private" | "listed";
export type RequirementScope =
  | "program_entry"
  | "program_maintenance"
  | "tier"
  | "campaign"
  | "benefit"
  | "invite";

export type BudgetMode = "none" | "metered" | "funded";
export type BudgetAsset = "usd" | "credit";
export type SubjectKind = "event" | "offer" | "resource" | (string & {});

export type DeploymentMode = "owned" | "partner" | "paid";
export type DeploymentMedium =
  | "social"
  | "email"
  | "web"
  | "search"
  | "display"
  | "video"
  | "audio"
  | "referral"
  | "event"
  | "retail"
  | "out_of_home"
  | "broadcast"
  | "sports"
  | (string & {});
export type DeploymentDesiredStatus = "active" | "paused" | "canceled";
export type DeploymentObservedStatus =
  | "pending"
  | "provisioning"
  | "live"
  | "paused"
  | "pending_review"
  | "rejected"
  | "failed"
  | "completed"
  | "unknown";

export type ConnectionKind = "social_profile" | "ad_account" | "page" | "pixel" | "payout" | (string & {});

export type OperationStatus =
  | "pending"
  | "running"
  | "waiting"
  | "succeeded"
  | "partial"
  | "failed"
  | "canceled";
export type OperationWaitingReason =
  | "funding_required"
  | "provider_review"
  | "awaiting_target_settle"
  | "awaiting_children_settle"
  | "awaiting_cleanup"
  | (string & {});

/** Public event vocabulary (DISTRIBUTION_CORE §4; registry stays open). */
export type BoominEventType =
  | "distribution.launching"
  | "distribution.live"
  | "distribution.paused"
  | "distribution.resumed"
  | "distribution.completed"
  | "distribution.failed"
  | "distribution.canceled"
  | "deployment.created"
  | "deployment.activated"
  | "deployment.rejected"
  | "deployment.paused"
  | "deployment.completed"
  | "deployment.drifted"
  | "deployment.cancel_requested"
  | "deployment.canceled"
  | "deployment.cleanup_failed"
  | "partnership.created"
  | "partnership.activated"
  | "partnership.paused"
  | "partnership.resumed"
  | "partnership.ended"
  | "enrollment.created"
  | "enrollment.approved"
  | "enrollment.rejected"
  | "enrollment.activated"
  | "payout.created"
  | "payout.settled"
  | "payout.failed"
  | "operation.succeeded"
  | "operation.failed"
  | "operation.cancel_requested"
  | "operation.canceled"
  | "operation.superseded"
  | "budget.reserved"
  | "budget.released"
  | "budget.reserve_failed"
  | (string & {});

// ---------------------------------------------------------------------------
// API objects
// ---------------------------------------------------------------------------

interface BaseObject {
  id: string;
  livemode?: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Program extends BaseObject {
  object?: "program";
  name?: string;
  type?: ProgramType;
  description?: string | null;
  status?: ProgramStatus;
  visibility?: ProgramVisibility;
  metadata?: Metadata;
}

export interface ProgramRequirement extends BaseObject {
  object?: "program.requirement";
  /** `prog_…` reference (the wire field is `program`, not `program_id`). */
  program?: string;
  scope?: RequirementScope;
  scope_id?: string;
  metric_key?: string;
  operator?: "gte" | "lte" | "eq" | "neq" | "exists";
  threshold?: number | null;
  window_days?: number | null;
  source?: string;
  weight?: number;
  required?: boolean;
  status?: "active" | "paused" | "archived";
  metadata?: Metadata;
}

export interface ProgramTier extends BaseObject {
  object?: "program.tier";
  /** `prog_…` reference (the wire field is `program`, not `program_id`). */
  program?: string;
  name?: string;
  rank?: number;
  status?: "active" | "paused" | "archived";
  metadata?: Metadata;
}

/** `null` until the program's connect surface has been minted. */
export interface ProgramConnectConfig {
  object?: "program.connect_config";
  public_key?: string;
  allowed_origins?: string[];
  allowed_redirect_origins?: string[];
  required_channels?: string[];
  default_approval_status?: "pending" | "approved";
  metadata?: Metadata;
  [key: string]: unknown;
}

export interface ProgramHandoffConfig {
  issuer?: string;
  audience?: string;
  /** Returned only when just created or explicitly supplied. */
  signing_secret?: string;
  [key: string]: unknown;
}

export interface Partner extends BaseObject {
  object?: "partner";
  kind?: string;
  name?: string | null;
  email?: string | null;
  metadata?: Metadata;
}

export interface Partnership extends BaseObject {
  object?: "partnership";
  /** `ptnr_…` id, or an inlined `{id, name, email}` on list/retrieve. */
  partner?: string | { id: string; name: string | null; email: string | null };
  status: PartnershipStatus;
  rights?: Record<string, unknown> | null;
  permissions?: Record<string, unknown> | null;
  compensation_defaults?: Record<string, unknown> | null;
  source?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface Enrollment extends BaseObject {
  object?: "enrollment";
  /** `prog_…` / `pship_…` / `ptnr_…` references — flat, not `*_id` fields. */
  program: string;
  partnership: string;
  partner?: string;
  /** The brand's decision — never touched by pause/resume/archive. */
  approval_status: EnrollmentApprovalStatus;
  /** Participation lifecycle — never touched by approve/reject. */
  status: EnrollmentStatus;
  billing_status?: EnrollmentBillingStatus;
  qualification_status?: string | null;
  referral_code?: string | null;
  metadata?: Metadata;
  joined_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
}

/** Live budget echo — `total` is minor units; `consumed`/`released` come off
 *  the reservation (0 when none exists yet). */
export interface DistributionBudget {
  mode: BudgetMode;
  asset: BudgetAsset | null;
  total: number | null;
  consumed: number;
  released: number;
}

export interface Distribution extends BaseObject {
  object?: "distribution";
  name?: string | null;
  description?: string | null;
  objective: DistributionObjective;
  status: DistributionStatus;
  /** Deployment plan slots, enrollment policy, destination URL, asset refs. */
  spec?: Record<string, unknown>;
  plan_hash?: string | null;
  /** Associated `prog_…` ids (plural from the first release). */
  programs?: string[];
  budget?: DistributionBudget;
  /** Present on retrieve/list: `{ total, live }` rollup. */
  deployments?: { total: number; live: number };
  stats?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  launched_at?: string | null;
  paused_at?: string | null;
  completed_at?: string | null;
  canceled_at?: string | null;
  failed_at?: string | null;
}

/** The verdict `distributions.validate` returns alongside the distribution. */
export interface DistributionValidation extends Distribution {
  valid: boolean;
  errors: unknown[];
}

/**
 * 202 body of `distributions.launch` — never a synchronous success.
 *
 * Both refs are id STRINGS, not embedded objects: the operation is the
 * progress surface. Pass `operation` straight to `operations.wait()`.
 */
export interface DistributionLaunchResult {
  distribution: string;
  status: "launching";
  operation: string;
  [key: string]: unknown;
}

export interface Deployment extends BaseObject {
  object?: "deployment";
  /** `dist_…` reference (the wire field is `distribution`). */
  distribution: string;
  mode: DeploymentMode;
  medium: DeploymentMedium;
  channel?: string;
  format?: string;
  adapter?: string;
  /** Stable slot key, UNIQUE per distribution (e.g. `enroll_123:instagram:reel:primary`). */
  deployment_key?: string;
  /** `pship_…` / `enr_…` / `conn_…` references — flat, not `*_id` fields. */
  partnership?: string | null;
  enrollment?: string | null;
  connection?: string | null;
  /** Desired lifecycle state (what the platform is driving toward). */
  status: DeploymentDesiredStatus;
  /** Provider-observed state (never written by intent). */
  observed_status?: DeploymentObservedStatus;
  desired_state?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  external_ids?: Record<string, unknown>;
  budget_allocation_minor?: number | null;
}

export interface Connection extends BaseObject {
  object?: "connection";
  kind: ConnectionKind;
  provider: string;
  provider_account_id?: string | null;
  /** Owner is a partner XOR a brand — one discriminated field, not two ids. */
  owner?: { type: "partner" | "brand"; id: string };
  status?: string;
  scopes?: string[] | null;
  connected_at?: string | null;
  disconnected_at?: string | null;
}

export interface PerformanceEvent extends BaseObject {
  object?: "performance_event";
  /** `dep_…` / `dist_…` references — flat, not `*_id` fields. */
  deployment: string;
  distribution: string;
  type?: string;
  source?: string;
  /** Minor units (cents), not `value`. */
  value_minor?: number | null;
  currency?: string | null;
  quantity?: number | null;
  occurred_at?: string;
  received_at?: string;
  properties?: Record<string, unknown>;
  /** True when this event replayed an existing idempotency/external id. */
  duplicate?: boolean;
  /**
   * Whether the event reached the metric tables payouts read. Only mapped
   * types project (`click` | `sale` | `purchase` | `install` | `referral`,
   * plus the raw metric keys) — an unmapped type is recorded and visible in
   * the summary but can never pay anyone.
   */
  projected?: boolean;
}

export interface PerformanceSummary {
  object?: "performance_summary";
  [key: string]: unknown;
}

/** Operational domain-event feed item (also the webhook envelope). */
export interface BoominEvent {
  id: string;
  object?: "event";
  type: BoominEventType;
  /** Monotonic feed cursor. */
  seq?: number;
  data: { object: Record<string, unknown>; [key: string]: unknown };
  livemode?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface OperationError {
  code?: BoominErrorCode;
  message?: string;
  [key: string]: unknown;
}

export interface Operation extends BaseObject {
  object?: "operation";
  /** One nested subject ref, not a `subject_type`/`subject_id` pair. */
  subject: { type: string; id: string };
  /** e.g. `distribution.launch`, `deployment.apply`, `payout_batch.disburse`. */
  kind: string;
  status: OperationStatus;
  /** Why a `waiting` operation is parked — the whole diagnosis when a launch
   *  appears to hang (`funding_required` is the common one). */
  waiting_reason?: OperationWaitingReason | null;
  attempts?: number;
  max_attempts?: number;
  target_operation_id?: string | null;
  error?: OperationError | null;
  progress?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  completed_at?: string | null;
}

export interface WebhookEndpoint extends BaseObject {
  object?: "webhook_endpoint";
  url: string;
  /** Subscribed event types (public vocabulary). */
  enabled_events?: BoominEventType[];
  status?: string;
  /** Signing secret — returned on create only. */
  secret?: string;
  description?: string | null;
}

export interface Payout extends BaseObject {
  object?: "payout";
  status?: "pending" | "awaiting_account" | "processing" | "paid" | "failed" | (string & {});
  /** Cents — the wire field is `amount_cents`. */
  amount_cents?: number;
  currency?: string;
  period_start?: string;
  period_end?: string;
  source_kind?: "rule" | "collaborator";
  rule_id?: string | null;
  recipient?: { kind: "user" | "partner"; id: string | null; name: string | null; email: string | null };
  basis_kind?: string | null;
  basis_cents?: number | null;
  basis_metric_key?: string | null;
  basis_metric_value?: number | null;
  rate_bps?: number | null;
}

export interface PayoutBatch extends BaseObject {
  object?: "payout_batch";
  rail?: string;
  status?: string;
  item_count?: number;
  /** Cents — the wire field is `total_amount_cents`. */
  total_amount_cents?: number;
  currency?: string;
  period_start?: string | null;
  period_end?: string | null;
  export_file_key?: string | null;
  export_format?: string | null;
  /** Present on `exportCsv`; may be null when presigning is unavailable — a
   *  null here means the file was NOT delivered, even though the call is 201. */
  download_url?: string | null;
  exported_at?: string | null;
  error?: Record<string, unknown> | null;
}

/** `payouts.run` recomputes the period and returns the rows plus a summary. */
export interface PayoutRun {
  object?: "payout_run";
  payouts: Payout[];
  summary: Record<string, unknown>;
}

export interface PayoutConnectStatus {
  object?: "payout_connect_status";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Resource clients
// ---------------------------------------------------------------------------

export interface ProgramSubcollection<T> {
  create(programId: string, params: Params, options?: RequestOptions): Promise<T>;
  retrieve(programId: string, id: string, options?: RequestOptions): Promise<T>;
  update(programId: string, id: string, params: Params, options?: RequestOptions): Promise<T>;
  list(programId: string, params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<T>;
  del(programId: string, id: string, options?: RequestOptions): Promise<unknown>;
}

export interface ProgramConfigClient<T> {
  retrieve(programId: string, options?: RequestOptions): Promise<T>;
  update(programId: string, params: Params, options?: RequestOptions): Promise<T>;
}

export interface ProgramCreateParams {
  name: string;
  /** Defaults to `performance`. There is no `affiliate` type. */
  type?: ProgramType;
  description?: string | null;
  visibility?: ProgramVisibility;
  metadata?: Metadata;
}

export interface ProgramUpdateParams {
  name?: string;
  description?: string | null;
  status?: ProgramStatus;
  visibility?: ProgramVisibility;
  metadata?: Metadata;
}

export interface ProgramsClient {
  create(params: Params<ProgramCreateParams>, options?: RequestOptions): Promise<Program>;
  retrieve(id: string, options?: RequestOptions): Promise<Program>;
  update(id: string, params: Params<ProgramUpdateParams>, options?: RequestOptions): Promise<Program>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<Program>;
  requirements: ProgramSubcollection<ProgramRequirement>;
  tiers: ProgramSubcollection<ProgramTier>;
  connectConfig: ProgramConfigClient<ProgramConnectConfig>;
  handoffConfig: ProgramConfigClient<ProgramHandoffConfig>;
}

export interface PartnersClient {
  retrieve(id: string, options?: RequestOptions): Promise<Partner>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<Partner>;
}

export interface PartnershipsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Partnership>;
  list(
    params?: Params<PaginationParams & { partner?: string; status?: PartnershipStatus }>,
    options?: RequestOptions,
  ): ListPromise<Partnership>;
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Partnership>;
  /** `resume` is the canonical verb on every surface — never `unpause`. */
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Partnership>;
  /** The explicit terminal command for the durable relationship. */
  end(id: string, params?: Params, options?: RequestOptions): Promise<Partnership>;
  updatePermissions(
    id: string,
    params: Params<{ permissions?: Record<string, unknown> }>,
    options?: RequestOptions,
  ): Promise<Partnership>;
}

export interface EnrollmentCreateParams {
  /** The Program this enrollment participates in (flat client — payload carries program). */
  program: string;
  /** Identify the invitee by `ptnr_…` id OR by email — one of the two is required. */
  partner?: string;
  email?: string;
  /** Display name, used when the email creates a new partner. */
  name?: string;
  referralCode?: string;
  metadata?: Metadata;
}

export interface EnrollmentsClient {
  /** Invite — creates the enrollment as (pending, active). */
  create(params: Params<EnrollmentCreateParams>, options?: RequestOptions): Promise<Enrollment>;
  retrieve(id: string, options?: RequestOptions): Promise<Enrollment>;
  list(
    params?: Params<
      PaginationParams & {
        program?: string;
        partnership?: string;
        approvalStatus?: EnrollmentApprovalStatus;
        status?: EnrollmentStatus;
        // (list filters are query params: program, status, approval_status)
      }
    >,
    options?: RequestOptions,
  ): ListPromise<Enrollment>;
  /** approve/reject touch approval_status only. */
  approve(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  reject(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  /** pause/resume touch status only; links keep resolving while paused. */
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
}

export interface DistributionSubjectParam {
  /** `kind` and `id` — NOT `subject_kind`/`subject_id`. */
  kind: SubjectKind;
  id: string;
  role?: string;
}

export interface DistributionCreateParams {
  /** Required. */
  name: string;
  objective?: DistributionObjective;
  description?: string | null;
  /** Program associations (`prog_…`) — plural from the first release. */
  programs?: string[];
  subjects?: DistributionSubjectParam[];
  /** `total` is minor units; `total_minor`/`totalMinor` are accepted aliases.
   *  Nested keys are sent verbatim (the SDK converts the top level only). */
  budget?: { mode: BudgetMode; asset?: BudgetAsset | null; total?: number | null; totalMinor?: number | null };
  /** Free-form plan payload — stored verbatim, never key-rewritten. */
  spec?: Record<string, unknown>;
}

export interface DistributionsClient {
  /** Creates in `draft`. */
  create(params: Params<DistributionCreateParams>, options?: RequestOptions): Promise<Distribution>;
  retrieve(id: string, options?: RequestOptions): Promise<Distribution>;
  /** Allowed in draft|ready; any update invalidates validation → draft. */
  update(id: string, params: Params<Partial<DistributionCreateParams>>, options?: RequestOptions): Promise<Distribution>;
  list(
    params?: Params<PaginationParams & { status?: DistributionStatus }>,
    options?: RequestOptions,
  ): ListPromise<Distribution>;
  /** Returns the distribution plus `{ valid, errors }`. */
  validate(id: string, params?: Params, options?: RequestOptions): Promise<DistributionValidation>;
  /** Always async: resolves the 202 `{ distribution, status: 'launching',
   *  operation }` — all id STRINGS. Takes no body fields. */
  launch(id: string, params?: Params, options?: RequestOptions): Promise<DistributionLaunchResult>;
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Distribution>;
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Distribution>;
  cancel(id: string, params?: Params, options?: RequestOptions): Promise<Distribution>;
}

export interface DeploymentsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Deployment>;
  list(
    params?: Params<
      PaginationParams & {
        distribution?: string;
        partnership?: string;
        mode?: DeploymentMode;
        status?: DeploymentDesiredStatus;
      }
    >,
    options?: RequestOptions,
  ): ListPromise<Deployment>;
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
  /** `resume` is the canonical verb on every surface — never `unpause`. */
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
  cancel(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
}

export interface ConnectionsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Connection>;
  list(
    params?: Params<PaginationParams & { provider?: string; kind?: ConnectionKind; partner?: string }>,
    options?: RequestOptions,
  ): ListPromise<Connection>;
  revoke(id: string, params?: Params, options?: RequestOptions): Promise<Connection>;
}

/**
 * ONE flat event per call, despite the plural collection name — there is no
 * `{ events: [...] }` batch envelope.
 */
export interface PerformanceEventCreateParams {
  /** `dep_…` id. Required. */
  deployment: string;
  /**
   * Required. Only `click` | `sale` | `purchase` | `install` | `referral`
   * (plus the raw metric keys) reach the metric tables payouts read; anything
   * else is recorded with `projected: false` and can never pay anyone.
   * `"conversion"` is NOT one of them.
   */
  type: string;
  source?: string;
  /** Minor units (cents) — the field is `value_minor`, not `value`. */
  valueMinor?: number | null;
  currency?: string | null;
  quantity?: number;
  occurredAt?: string;
  /** One of `externalEventId` / `idempotencyKey` is required (ingest identity). */
  externalEventId?: string;
  idempotencyKey?: string;
  /** Free-form — stored verbatim, never key-rewritten. */
  properties?: Record<string, unknown>;
}

export interface PerformanceClient {
  /** Rollup read (performance:read). */
  summary(params?: Params, options?: RequestOptions): Promise<PerformanceSummary>;
  /** Business measurement ingestion IN (performance:write). */
  events: {
    create(params: Params<PerformanceEventCreateParams>, options?: RequestOptions): Promise<PerformanceEvent>;
  };
}

export interface EventsClient {
  /** Operational domain-event feed OUT (events:read). */
  list(
    params?: Params<PaginationParams & { type?: BoominEventType }>,
    options?: RequestOptions,
  ): ListPromise<BoominEvent>;
}

export interface OperationWaitOptions extends RequestOptions {
  /** Total wait budget in ms (default 60000). */
  timeout?: number;
  /** Poll interval in ms (default 1000). */
  pollInterval?: number;
}

/** An operation id string, or anything carrying one on `.id`. */
export type OperationRef = string | { id: string };

export interface OperationsClient {
  retrieve(operation: OperationRef, options?: RequestOptions): Promise<Operation>;
  list(
    params?: Params<PaginationParams & { subjectType?: string; subjectId?: string; status?: OperationStatus }>,
    options?: RequestOptions,
  ): ListPromise<Operation>;
  /**
   * Poll until the operation is terminal (succeeded|partial|failed|canceled)
   * and return it — does NOT throw on failed operations. Throws
   * `operation_wait_timeout` when the wait budget elapses (the message carries
   * `waiting_reason` when the operation is parked).
   *
   * Accepts the id STRING that `launch` returns or the operation object that
   * `pause`/`resume`/`cancel` return.
   */
  wait(operation: OperationRef, options?: OperationWaitOptions): Promise<Operation>;
}

export interface WebhookEndpointCreateParams {
  url: string;
  /**
   * Event types to subscribe to. OMITTING THIS (or passing `[]`) subscribes
   * the endpoint to EVERY public event type.
   */
  enabledEvents?: BoominEventType[];
  description?: string | null;
}

export interface WebhookEndpointsClient {
  /** The response carries `secret` (whsec_…) — revealed on create ONLY. */
  create(params: Params<WebhookEndpointCreateParams>, options?: RequestOptions): Promise<WebhookEndpoint>;
  retrieve(id: string, options?: RequestOptions): Promise<WebhookEndpoint>;
  update(
    id: string,
    params: Params<Partial<WebhookEndpointCreateParams> & { status?: "enabled" | "disabled" }>,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<WebhookEndpoint>;
  /**
   * Installs a fresh signing secret (revealed once in this response); the
   * previous secret stays honored for a rotation overlap window.
   */
  rotateSecret(id: string, params?: Params, options?: RequestOptions): Promise<WebhookEndpoint>;
  del(id: string, options?: RequestOptions): Promise<unknown>;
}

export interface WebhooksClient {
  endpoints: WebhookEndpointsClient;
}

export interface PayoutPeriodParams {
  /** `YYYY-MM-DD`. */
  periodStart: string;
  /** `YYYY-MM-DD`, exclusive of / after periodStart. */
  periodEnd: string;
}

export interface PayoutsClient {
  list(
    params?: Params<PaginationParams & { status?: string; periodStart?: string; periodEnd?: string }>,
    options?: RequestOptions,
  ): ListPromise<Payout>;
  /**
   * Recompute the period's payout rows. Both dates are REQUIRED. Returns zero
   * rows until the brand has at least one active payout rule.
   */
  run(params: Params<PayoutPeriodParams>, options?: RequestOptions): Promise<PayoutRun>;
  /** Build + export a csv_batch over the eligible rows on the csv_batch rail. */
  exportCsv(params?: Params<Partial<PayoutPeriodParams>>, options?: RequestOptions): Promise<PayoutBatch>;
  /** Stripe Connect payout-account status. */
  connectStatus(params?: Params, options?: RequestOptions): Promise<PayoutConnectStatus>;
  batches: {
    retrieve(id: string, options?: RequestOptions): Promise<PayoutBatch>;
    list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<PayoutBatch>;
  };
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export declare class Boomin {
  constructor(secretKey: string, options?: BoominOptions);

  static readonly VERSION: string;
  /** Static webhook helpers: `await Boomin.webhooks.constructEvent(payload, sig, secret)`. */
  static readonly webhooks: {
    constructEvent(
      payload: string | Uint8Array | ArrayBuffer,
      sigHeader: string,
      secret: string | string[],
      options?: ConstructEventOptions,
    ): Promise<BoominEvent>;
  };

  readonly programs: ProgramsClient;
  readonly partners: PartnersClient;
  readonly partnerships: PartnershipsClient;
  readonly enrollments: EnrollmentsClient;
  readonly distributions: DistributionsClient;
  readonly deployments: DeploymentsClient;
  readonly connections: ConnectionsClient;
  readonly performance: PerformanceClient;
  readonly events: EventsClient;
  readonly operations: OperationsClient;
  readonly webhooks: WebhooksClient;
  readonly payouts: PayoutsClient;
}

export default Boomin;

export { constructEvent, type ConstructEventOptions } from "./webhooks.js";
export {
  BoominError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  RateLimitError,
  ConflictError,
  APIError,
  OperationConflictError,
  BandLimitReachedError,
  FundingRequiredError,
  WebhookSignatureVerificationError,
  type BoominErrorCode,
} from "./errors.js";
