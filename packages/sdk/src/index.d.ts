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
  /** Page size. */
  limit?: number;
  /** Cursor: return items after this object id. Sent as `starting_after`. */
  startingAfter?: string;
  /** Cursor: return items before this object id. Sent as `ending_before`. */
  endingBefore?: string;
}

/** Open params object: known fields are typed, unknown fields pass through. */
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
  description?: string | null;
  status?: string;
  metadata?: Metadata;
}

export interface ProgramRequirement extends BaseObject {
  object?: "program_requirement";
  program_id?: string;
  kind?: string;
  config?: Record<string, unknown>;
}

export interface ProgramTier extends BaseObject {
  object?: "program_tier";
  program_id?: string;
  name?: string;
  rank?: number;
  config?: Record<string, unknown>;
}

export interface ProgramConnectConfig {
  program_id?: string;
  [key: string]: unknown;
}

export interface ProgramHandoffConfig {
  program_id?: string;
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
  brand_id?: string;
  partner_id?: string;
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
  program_id: string;
  partnership_id: string;
  /** The brand's decision — never touched by pause/resume/archive. */
  approval_status: EnrollmentApprovalStatus;
  /** Participation lifecycle — never touched by approve/reject. */
  status: EnrollmentStatus;
  billing_status?: EnrollmentBillingStatus;
  referral_code?: string | null;
  participant_brand_id?: string | null;
  joined_at?: string | null;
}

export interface DistributionSubject {
  subject_kind: SubjectKind;
  subject_id: string;
  role?: string | null;
  [key: string]: unknown;
}

export interface Distribution extends BaseObject {
  object?: "distribution";
  name?: string | null;
  description?: string | null;
  objective: DistributionObjective;
  status: DistributionStatus;
  /** Deployment plan slots, enrollment policy, destination URL, asset refs. */
  spec?: Record<string, unknown>;
  /** Associated program ids (plural from the first release). */
  programs?: string[];
  subjects?: DistributionSubject[];
  budget_mode?: BudgetMode;
  budget_asset?: BudgetAsset | null;
  budget_total_minor?: number | null;
  reservation_id?: string | null;
  stats?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  launched_at?: string | null;
  completed_at?: string | null;
  canceled_at?: string | null;
}

/** 202 body of `distributions.launch` — never a synchronous success. */
export interface DistributionLaunchResult {
  distribution: Distribution;
  status: "launching";
  operation: Operation;
  [key: string]: unknown;
}

export interface Deployment extends BaseObject {
  object?: "deployment";
  distribution_id: string;
  mode: DeploymentMode;
  medium: DeploymentMedium;
  channel?: string;
  format?: string;
  adapter?: string;
  /** Stable slot key, UNIQUE per distribution (e.g. `enroll_123:instagram:reel:primary`). */
  deployment_key?: string;
  partnership_id?: string | null;
  program_enrollment_id?: string | null;
  connection_id?: string | null;
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
  owner_partner_id?: string | null;
  owner_brand_id?: string | null;
  status?: string;
  revoked_at?: string | null;
}

export interface PerformanceEvent extends BaseObject {
  object?: "performance_event";
  deployment_id: string;
  distribution_id: string;
  provider?: string;
  type?: string;
  source?: string;
  external_event_id?: string | null;
  idempotency_key?: string | null;
  value?: number | null;
  currency?: string | null;
  quantity?: number | null;
  occurred_at?: string;
  received_at?: string;
  properties?: Record<string, unknown>;
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
  subject_type: string;
  subject_id: string;
  /** e.g. `distribution.launch`, `deployment.apply`, `payout_batch.disburse`. */
  kind: string;
  status: OperationStatus;
  waiting_reason?: OperationWaitingReason | null;
  parent_operation_id?: string | null;
  error?: OperationError | null;
  finished_at?: string | null;
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
  status?: string;
  amount_minor?: number;
  currency?: string;
  partner_id?: string | null;
  partnership_id?: string | null;
  recipient_brand_id?: string | null;
  batch_id?: string | null;
}

export interface PayoutBatch extends BaseObject {
  object?: "payout_batch";
  rail?: string;
  status?: string;
  item_count?: number;
  total_minor?: number;
  currency?: string;
  /** csv_batch rail: download URL for the exported file. */
  file_url?: string | null;
  operation_id?: string | null;
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

export interface ProgramsClient {
  create(params: Params<{ name?: string; description?: string; metadata?: Metadata }>, options?: RequestOptions): Promise<Program>;
  retrieve(id: string, options?: RequestOptions): Promise<Program>;
  update(id: string, params: Params, options?: RequestOptions): Promise<Program>;
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
  partner?: string;
  partnership?: string;
  email?: string;
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

export interface DistributionCreateParams {
  objective: DistributionObjective;
  name?: string;
  description?: string;
  /** Program associations — plural from the first release. */
  programs?: string[];
  spec?: Record<string, unknown>;
  subjects?: Array<Params<{ subjectKind?: SubjectKind; subject_kind?: SubjectKind; subject_id?: string; role?: string }>>;
  budget?: Params<{ mode?: BudgetMode; asset?: BudgetAsset; totalMinor?: number; total_minor?: number }>;
  metadata?: Metadata;
}

export interface DistributionsClient {
  /** Creates in `draft`. */
  create(params: Params<DistributionCreateParams>, options?: RequestOptions): Promise<Distribution>;
  retrieve(id: string, options?: RequestOptions): Promise<Distribution>;
  /** Allowed in draft|ready; any update invalidates validation → draft. */
  update(id: string, params: Params<Partial<DistributionCreateParams>>, options?: RequestOptions): Promise<Distribution>;
  list(
    params?: Params<PaginationParams & { status?: DistributionStatus; program?: string }>,
    options?: RequestOptions,
  ): ListPromise<Distribution>;
  validate(id: string, params?: Params, options?: RequestOptions): Promise<Distribution>;
  /** Always async: resolves the 202 `{ distribution, status: 'launching', operation }`. */
  launch(id: string, params?: Params<{ dryRun?: boolean }>, options?: RequestOptions): Promise<DistributionLaunchResult>;
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
}

export interface ConnectionsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Connection>;
  list(
    params?: Params<PaginationParams & { provider?: string; kind?: ConnectionKind; partner?: string }>,
    options?: RequestOptions,
  ): ListPromise<Connection>;
  revoke(id: string, params?: Params, options?: RequestOptions): Promise<Connection>;
}

export interface PerformanceEventCreateParams {
  deployment?: string;
  distribution?: string;
  type?: string;
  source?: string;
  externalEventId?: string;
  idempotencyKey?: string;
  value?: number;
  currency?: string;
  quantity?: number;
  occurredAt?: string;
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

export interface OperationsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Operation>;
  list(
    params?: Params<PaginationParams & { subjectType?: string; subjectId?: string; status?: OperationStatus }>,
    options?: RequestOptions,
  ): ListPromise<Operation>;
  /**
   * Poll until the operation is terminal (succeeded|partial|failed|canceled)
   * and return it — does NOT throw on failed operations. Throws
   * `operation_wait_timeout` when the wait budget elapses.
   */
  wait(id: string, options?: OperationWaitOptions): Promise<Operation>;
}

export interface WebhookEndpointsClient {
  create(
    params: Params<{ url: string; enabledEvents?: BoominEventType[]; description?: string }>,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint>;
  retrieve(id: string, options?: RequestOptions): Promise<WebhookEndpoint>;
  update(id: string, params: Params, options?: RequestOptions): Promise<WebhookEndpoint>;
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

export interface PayoutsClient {
  list(
    params?: Params<PaginationParams & { status?: string; partner?: string }>,
    options?: RequestOptions,
  ): ListPromise<Payout>;
  /** Run disbursement over eligible payouts (returns batch + operation). */
  run(params?: Params<{ rail?: string }>, options?: RequestOptions): Promise<PayoutBatch>;
  /** Export eligible payouts on the csv_batch rail. */
  exportCsv(params?: Params<{ format?: string }>, options?: RequestOptions): Promise<PayoutBatch>;
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
