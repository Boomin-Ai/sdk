/**
 * @boomin/sdk — hand-written type surface (no codegen).
 * Object shapes follow DISTRIBUTION_CORE (frozen 2026-08-01).
 *
 * CASING: the SDK is camelCase in BOTH directions. Params are written in
 * camelCase (snake_case is still accepted, but never both spellings of the same
 * field — that throws ConflictingParametersError), and every response is
 * camelCased on the way back: `event.valueMinor`, `page.hasMore`,
 * `enrollment.approvalStatus`. The REST wire stays snake_case; translating is
 * the SDK's job. The one exception, in both directions, is customer-owned
 * free-form payloads — `metadata`, `properties`, `spec`, `permissions`,
 * `rights`, `compensationDefaults`, `desiredState`, `observedState`,
 * `externalIds`, `stats` — whose keys round-trip byte-identical.
 * See `OPAQUE_FIELDS` and `REQUEST_FIELD_MAP` in src/casing.js.
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
  /**
   * Return the wire's raw snake_case objects instead of camelCasing them.
   * Default false. Client-level on purpose — the return shape is a property of
   * the client, and a per-call flag would make the signatures below lie at half
   * the call sites. Reach for it when proxying or logging responses verbatim.
   *
   * NOTE: with this on, every response type below reads in its snake_case wire
   * spelling instead (`has_more`, `value_minor`, `approval_status`).
   */
  rawResponses?: boolean;
  /** fetch implementation override (testing / exotic runtimes). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /**
   * Idempotency key for this mutation. Travels in the `Idempotency-Key`
   * HEADER — never in the body. Auto-generated (crypto.randomUUID) when
   * omitted; pass your own to make cross-process retries idempotent, and to
   * give `performance.events.create` its ingest identity.
   *
   * Idempotency is header-canonical across the v1 tree: an `idempotencyKey`
   * written into a PARAMS object is just an unknown body field, and the API
   * answers 400 `invalid_request`.
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
  /** Wire field `has_more` — the SDK camelCases every response key. */
  hasMore: boolean;
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
 * extra key is a runtime error, not a silent no-op.
 *
 * Params are written in camelCase or snake_case. The SDK converts every body
 * and query string to the snake_case wire form, recursing into the nested
 * structures the API owns (declared in `REQUEST_FIELD_MAP`, src/casing.js) and
 * never into the ones you own. Supplying BOTH spellings of one field
 * (`{ enabledEvents, enabled_events }`) throws `ConflictingParametersError`
 * before the request is issued.
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
  createdAt?: string;
  updatedAt?: string;
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
  scopeId?: string;
  metricKey?: string;
  operator?: "gte" | "lte" | "eq" | "neq" | "exists";
  threshold?: number | null;
  windowDays?: number | null;
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
  publicKey?: string;
  allowedOrigins?: string[];
  allowedRedirectOrigins?: string[];
  requiredChannels?: string[];
  defaultApprovalStatus?: "pending" | "approved";
  metadata?: Metadata;
  [key: string]: unknown;
}

export interface ProgramHandoffConfig {
  issuer?: string;
  audience?: string;
  /** Returned only when just created or explicitly supplied. */
  signingSecret?: string;
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
  /** Customer-extensible terms — keys inside are NEVER rewritten. */
  rights?: Record<string, unknown> | null;
  permissions?: Record<string, unknown> | null;
  compensationDefaults?: Record<string, unknown> | null;
  source?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface Enrollment extends BaseObject {
  object?: "enrollment";
  /** `prog_…` / `pship_…` / `ptnr_…` references — flat, not `*_id` fields. */
  program: string;
  partnership: string;
  partner?: string;
  /** The brand's decision — never touched by pause/resume/archive. */
  approvalStatus: EnrollmentApprovalStatus;
  /** Participation lifecycle — never touched by approve/reject. */
  status: EnrollmentStatus;
  billingStatus?: EnrollmentBillingStatus;
  qualificationStatus?: string | null;
  referralCode?: string | null;
  metadata?: Metadata;
  joinedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
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
  /** Deployment plan slots, enrollment policy, destination URL, asset refs.
   *  Customer-extensible: keys inside are NEVER rewritten, either direction. */
  spec?: Record<string, unknown>;
  planHash?: string | null;
  /** Associated `prog_…` ids (plural from the first release). */
  programs?: string[];
  budget?: DistributionBudget;
  /** Present on retrieve/list: `{ total, live }` rollup. */
  deployments?: { total: number; live: number };
  /** Metric-keyed rollup — keys are metric keys, never rewritten. */
  stats?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  launchedAt?: string | null;
  pausedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  failedAt?: string | null;
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
  deploymentKey?: string;
  /** `pship_…` / `enr_…` / `conn_…` references — flat, not `*_id` fields. */
  partnership?: string | null;
  enrollment?: string | null;
  connection?: string | null;
  /** Desired lifecycle state (what the platform is driving toward). */
  status: DeploymentDesiredStatus;
  /** Provider-observed state (never written by intent). */
  observedStatus?: DeploymentObservedStatus;
  /** Adapter-owned blobs — keys inside are NEVER rewritten, either direction. */
  desiredState?: Record<string, unknown>;
  observedState?: Record<string, unknown>;
  externalIds?: Record<string, unknown>;
  budgetAllocationMinor?: number | null;
}

export interface Connection extends BaseObject {
  object?: "connection";
  kind: ConnectionKind;
  provider: string;
  providerAccountId?: string | null;
  /** Owner is a partner XOR a brand — one discriminated field, not two ids. */
  owner?: { type: "partner" | "brand"; id: string };
  status?: string;
  scopes?: string[] | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
}

export interface PerformanceEvent extends BaseObject {
  object?: "performance_event";
  /** `dep_…` / `dist_…` references — flat, not `*_id` fields. */
  deployment: string;
  distribution: string;
  type?: string;
  source?: string;
  /** Minor units (cents), not `value`. Wire field `value_minor`. */
  valueMinor?: number | null;
  currency?: string | null;
  quantity?: number | null;
  occurredAt?: string;
  receivedAt?: string;
  /** Your own event vocabulary — keys round-trip byte-identical. */
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
  object?: "performance.summary";
  filters?: { distribution: string | null; deployment: string | null };
  events?: number;
  /** Minor units (cents) across every counted event. Wire field `value_minor`. */
  valueMinor?: number;
  /** Wire field `by_type` — an array, not a map. */
  byType?: Array<{ type: string; events: number; valueMinor: number; quantity: number }>;
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
  createdAt?: string;
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
  waitingReason?: OperationWaitingReason | null;
  attempts?: number;
  maxAttempts?: number;
  targetOperationId?: string | null;
  error?: OperationError | null;
  progress?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  completedAt?: string | null;
}

export interface WebhookEndpoint extends BaseObject {
  object?: "webhook_endpoint";
  url: string;
  /** Subscribed event types (public vocabulary). Wire field `enabled_events`. */
  enabledEvents?: BoominEventType[];
  status?: string;
  /** Signing secret — returned on create only. */
  secret?: string;
  description?: string | null;
}

export interface Payout extends BaseObject {
  object?: "payout";
  status?: "pending" | "awaiting_account" | "processing" | "paid" | "failed" | (string & {});
  /** Cents — the wire field is `amount_cents`. */
  amountCents?: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  sourceKind?: "rule" | "collaborator";
  ruleId?: string | null;
  recipient?: { kind: "user" | "partner"; id: string | null; name: string | null; email: string | null };
  basisKind?: string | null;
  basisCents?: number | null;
  basisMetricKey?: string | null;
  basisMetricValue?: number | null;
  rateBps?: number | null;
}

export interface PayoutBatch extends BaseObject {
  object?: "payout_batch";
  rail?: string;
  status?: string;
  itemCount?: number;
  /** Cents — the wire field is `total_amount_cents`. */
  totalAmountCents?: number;
  currency?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  exportFileKey?: string | null;
  exportFormat?: string | null;
  /**
   * The presigned artifact URL, RE-MINTED on every `batches.retrieve` of a
   * batch that has an export file. It is deliberately absent from the export
   * mutation's 202: a URL handed back there would already be expiring by the
   * time an operator opened it, and could not be re-obtained without
   * re-exporting.
   *
   * `null` on a batch that has an `exportFileKey` means presigning credentials
   * are unavailable — the file exists but was NOT delivered.
   */
  downloadUrl?: string | null;
  exportedAt?: string | null;
  error?: Record<string, unknown> | null;
  /** Frozen items, returned alongside the batch by `create` and `retrieve`. */
  items?: PayoutBatchItem[];
  /** Rows excluded from the batch, with the reason (`create` only). */
  skipped?: Array<Record<string, unknown>>;
}

export interface PayoutBatchItem {
  id: string;
  payoutId?: string;
  status?: string;
  amountCents?: number;
  currency?: string;
  recipient?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** How a run finished. Branch on THIS, never on a count. */
export type PayoutRunOutcome = "payouts_created" | "no_eligible_activity" | (string & {});

/**
 * `payouts.run` recomputes the period and reports what it evaluated.
 *
 * There is no `warnings[]`: an automated caller branches on `outcome` and reads
 * the counters. A brand with nothing configured never reaches this shape — it
 * throws `PayoutRulesRequiredError` (409).
 */
export interface PayoutRun {
  object?: "payout_run";
  outcome: PayoutRunOutcome;
  rulesEvaluated: number;
  splitsEvaluated: number;
  eventsEvaluated: number;
  payoutsCreated: number;
  /**
   * Structurally 0. Payout compute records OBLIGATIONS and never draws down a
   * budget; the field is reported so callers can branch on one diagnostic shape
   * across both engines. `awaitingAccount` is the count that actually blocks
   * money leaving.
   */
  underfunded: number;
  awaitingAccount: number;
  payouts: Payout[];
  summary: PayoutRunSummary;
}

export interface PayoutRunSummary {
  /** Minor units of the payouts' currency — the wire field is `total_amount_minor`. */
  totalAmountMinor: number;
  count: number;
  awaitingAccount: number;
  bridged: number;
  unresolvedRecipients: number;
}

/**
 * The 202 handed back by `exportCsv` and `batches.export`: ONE export contract.
 * `batch` and `operation` are id STRINGS — poll the operation, then read the
 * batch for `downloadUrl`.
 */
export interface PayoutExportAccepted {
  batch: string;
  status: "exporting" | (string & {});
  operation: string;
  /** `exportCsv` only — the build half is synchronous, so items are known now. */
  items?: PayoutBatchItem[];
  /** `exportCsv` only. */
  skipped?: Array<Record<string, unknown>>;
}

/** The 202 handed back by `batches.confirm`. */
export interface PayoutConfirmAccepted {
  batch: string;
  status: "confirming" | (string & {});
  operation: string;
}

export type PayoutRuleType = "revenue_split" | "cpa" | "threshold_bonus";
export type PayoutRuleStatus = "active" | "paused" | "archived";
export type PayoutRuleScopeType = "program" | "collection" | "unit" | "member";

/**
 * A rule's scope — a discriminated object, never a raw
 * `applies_to`/`scope_id`/`program_id` triple, so an incoherent combination
 * cannot be spelled. `program` is required on EVERY variant: the evaluator
 * resolves recipients through program membership, so a rule without one is
 * inert whatever its type.
 */
export type PayoutRuleScope =
  | { type: "program"; program: string }
  | { type: "collection"; program: string; collection: string }
  | { type: "unit"; program: string; unit: string }
  | { type: "member"; program: string; member: string };

/**
 * How a partner EARNS. Economics are IMMUTABLE after creation — see
 * `PayoutRulesClient.update`.
 */
export interface PayoutRule extends BaseObject {
  object?: "payout_rule";
  name: string;
  type: PayoutRuleType;
  scope: PayoutRuleScope;
  metricKey?: string | null;
  rateBps?: number | null;
  /**
   * Minor units of `currency` — the wire field is `per_unit_minor`, NOT cents.
   * The object carries its own currency and "cents" is a USD-specific word.
   */
  perUnitMinor?: number | null;
  threshold?: number | null;
  /** Minor units of `currency` — the wire field is `bonus_minor`. */
  bonusMinor?: number | null;
  windowKey?: string | null;
  windowDays?: number | null;
  currency: string;
  revenueBasis?: string | null;
  status: PayoutRuleStatus;
}

export type PayoutRailKind = "csv_batch" | "stripe_connect" | (string & {});
export type PayoutExportFormat = "paypal_payouts_csv" | "wise_batch_csv" | (string & {});

/**
 * ONE column of an exported file. This is YOUR data: `header` reaches the SDK's
 * casing boundary and comes back byte-identical, in the order you sent it,
 * because a renamed or reordered header is a different file for the bank that
 * ingests it. `key` is checked server-side against the closed slot vocabulary —
 * an unknown one would render as `undefined` in whatever column it names.
 */
export interface PayoutRailColumn {
  key: string;
  header: string;
}

/**
 * A rail's config is TWO things:
 *   `format` / `walletFunded`  API-owned, validated strictly, cased normally.
 *   `columns`                  customer-owned, preserved verbatim both ways.
 */
export interface PayoutRailConfig {
  /** REQUIRED on a csv_batch rail: PayPal's and Wise's column sets differ, so
   *  there is no neutral default and the API refuses to pick one. */
  format?: PayoutExportFormat;
  /** Turns `confirm` into a guarded wallet debit per item. */
  walletFunded?: boolean;
  columns?: PayoutRailColumn[];
}

/** How money physically LEAVES. */
export interface PayoutRail extends BaseObject {
  object?: "payout_rail";
  rail: PayoutRailKind;
  status: "active" | "disabled" | (string & {});
  /** At most one active default per (brand, livemode) — enforced in the DB. */
  isDefault: boolean;
  config: PayoutRailConfig;
  livemode?: boolean;
}

/** Rail identity + state as reported by `connectStatus` — never `config`. */
export interface PayoutConnectStatusRail {
  id: string;
  object?: "payout_rail";
  rail: PayoutRailKind;
  status: string;
  isDefault: boolean;
}

export interface PayoutConnectStatus {
  object?: "payouts.connect_status";
  /**
   * Identity and state ONLY. Rail `config` is a `payout_rails:read` surface —
   * read it with `payouts.rails.list()`.
   */
  rails: PayoutConnectStatusRail[];
  stripe: {
    configured: boolean;
    partnerAccounts: number;
    partnerAccountsPayoutsEnabled: number;
  };
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
  /** `email` is an exact, case-insensitive match. */
  list(params?: Params<PaginationParams & { email?: string }>, options?: RequestOptions): ListPromise<Partner>;
}

export interface PartnershipsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Partnership>;
  list(
    params?: Params<PaginationParams & { status?: PartnershipStatus }>,
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
        approvalStatus?: EnrollmentApprovalStatus;
        status?: EnrollmentStatus;
      }
    >,
    options?: RequestOptions,
  ): ListPromise<Enrollment>;
  /** approve/reject touch `approvalStatus` only. */
  approve(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  reject(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  /** pause/resume touch status only; links keep resolving while paused. */
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Enrollment>;
}

export interface DistributionSubjectParam {
  /** `kind` and `id` — NOT `subject_kind`/`subject_id`. API-owned and declared
   *  in REQUEST_FIELD_MAP, so camelCase inside an element converts too. */
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
  /** `total` is minor units; `totalMinor` is an accepted alias. API-owned and
   *  DECLARED in REQUEST_FIELD_MAP, so its keys convert like any other. */
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
    params?: Params<PaginationParams & { distribution?: string }>,
    options?: RequestOptions,
  ): ListPromise<Deployment>;
  pause(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
  /** `resume` is the canonical verb on every surface — never `unpause`. */
  resume(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
  cancel(id: string, params?: Params, options?: RequestOptions): Promise<Deployment & { operation: string }>;
}

export interface ConnectionsClient {
  retrieve(id: string, options?: RequestOptions): Promise<Connection>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<Connection>;
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
  /**
   * Ingest identity. Supply this, OR the per-call `{ idempotencyKey }` request
   * option — which travels in the `Idempotency-Key` HEADER. There is no body
   * `idempotencyKey`: idempotency is header-canonical across the whole v1 tree,
   * and sending it in a body is a 400.
   */
  externalEventId?: string;
  /** Free-form — stored verbatim, never key-rewritten. */
  properties?: Record<string, unknown>;
}

export interface PerformanceClient {
  /** Rollup read (performance:read), optionally scoped to one distribution or deployment. */
  summary(
    params?: Params<{ distribution?: string; deployment?: string }>,
    options?: RequestOptions,
  ): Promise<PerformanceSummary>;
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
   * `waitingReason` when the operation is parked).
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

/**
 * Create a payout rule. The type decides which economics are REQUIRED:
 *   revenue_split  → rateBps
 *   cpa            → metricKey + perUnitMinor
 *   threshold_bonus→ metricKey + threshold + bonusMinor
 * All of them are frozen the moment the rule exists.
 */
export interface PayoutRuleCreateParams {
  name: string;
  type: PayoutRuleType;
  scope: PayoutRuleScope;
  metricKey?: string;
  rateBps?: number;
  /** Minor units — `per_unit_minor` on the wire. */
  perUnitMinor?: number;
  threshold?: number;
  /** Minor units — `bonus_minor` on the wire. */
  bonusMinor?: number;
  windowKey?: string;
  windowDays?: number;
  /** ISO-4217, lowercase. Defaults to `usd`. */
  currency?: string;
}

/** The ONLY mutable fields on a rule. Everything else is `immutable_parameter`. */
export interface PayoutRuleUpdateParams {
  name?: string;
  status?: PayoutRuleStatus;
}

export interface PayoutRulesClient {
  create(params: Params<PayoutRuleCreateParams>, options?: RequestOptions): Promise<PayoutRule>;
  retrieve(id: string, options?: RequestOptions): Promise<PayoutRule>;
  list(
    params?: Params<PaginationParams & { program?: string; status?: PayoutRuleStatus; type?: PayoutRuleType }>,
    options?: RequestOptions,
  ): ListPromise<PayoutRule>;
  /**
   * `name` and `status` only. The ledger references the rule that produced each
   * row, so an economics edit would re-interpret settled history — sending one
   * throws `ImmutableParameterError`. Replace-then-archive instead.
   */
  update(id: string, params: Params<PayoutRuleUpdateParams>, options?: RequestOptions): Promise<PayoutRule>;
  /**
   * Stop the rule firing on the next run, keeping every ledger row it produced
   * readable. There is no `del()`: `payouts.rule_id` cascades, so a hard delete
   * would erase the record of money that was actually paid. Idempotent.
   */
  archive(id: string, params?: Params, options?: RequestOptions): Promise<PayoutRule>;
}

export interface PayoutRailCreateParams {
  rail: PayoutRailKind;
  config?: PayoutRailConfig;
  isDefault?: boolean;
  status?: "active" | "disabled";
}

export interface PayoutRailsClient {
  /**
   * Create, NOT upsert — a configured rail throws
   * `PayoutRailAlreadyExistsError` rather than being silently rewritten.
   */
  create(params: Params<PayoutRailCreateParams>, options?: RequestOptions): Promise<PayoutRail>;
  retrieve(id: string, options?: RequestOptions): Promise<PayoutRail>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<PayoutRail>;
  /** `config` REPLACES the stored object wholesale; there is no merge. */
  update(
    id: string,
    params: Params<Omit<PayoutRailCreateParams, "rail">>,
    options?: RequestOptions,
  ): Promise<PayoutRail>;
}

export interface PayoutBatchCreateParams {
  /** Omit to use the brand's default rail. */
  rail?: PayoutRailKind;
  periodStart?: string;
  periodEnd?: string;
}

export interface PayoutBatchConfirmParams {
  /**
   * The provider's own reference for this disbursement. Repeating a confirm
   * with the SAME ref replays one operation, so a retry after a timeout cannot
   * settle the run twice.
   */
  externalBatchRef?: string;
  /** Per-item outcomes; `item` must name an item of THIS batch. */
  results?: Array<{ item: string; status: "paid" | "failed" | "returned"; reason?: string }>;
}

export interface PayoutBatchesClient {
  /** Freeze the eligible rows into a batch — synchronous. */
  create(params?: Params<PayoutBatchCreateParams>, options?: RequestOptions): Promise<PayoutBatch>;
  /** Carries `downloadUrl`, re-minted on every read. */
  retrieve(id: string, options?: RequestOptions): Promise<PayoutBatch>;
  list(params?: Params<PaginationParams>, options?: RequestOptions): ListPromise<PayoutBatch>;
  /** 202 — poll `operation`, then read the batch for `downloadUrl`. */
  export(id: string, params?: Params, options?: RequestOptions): Promise<PayoutExportAccepted>;
  /** 202 — settling is per-item and uncapped, so it runs as an Operation. */
  confirm(
    id: string,
    params?: Params<PayoutBatchConfirmParams>,
    options?: RequestOptions,
  ): Promise<PayoutConfirmAccepted>;
  /** Unfreeze — synchronous. */
  cancel(id: string, params?: Params, options?: RequestOptions): Promise<PayoutBatch>;
}

export interface PayoutsClient {
  list(
    params?: Params<PaginationParams & { status?: string; partner?: string; periodStart?: string; periodEnd?: string }>,
    options?: RequestOptions,
  ): ListPromise<Payout>;
  /**
   * Recompute the period's payout rows. Both dates are REQUIRED.
   *
   * Branch on `outcome`, not on a count: a brand with no active rule and no
   * active content split throws `PayoutRulesRequiredError` (409) rather than
   * answering zero, because "nothing is configured" and "nothing qualified"
   * are different answers with different fixes.
   */
  run(params: Params<PayoutPeriodParams>, options?: RequestOptions): Promise<PayoutRun>;
  /**
   * Build + export on the csv_batch rail in one call — 202. The build half is
   * synchronous, so rail/empty failures still come back typed and immediately;
   * the file arrives via the operation and `batches.retrieve().downloadUrl`.
   */
  exportCsv(
    params?: Params<Partial<PayoutPeriodParams>>,
    options?: RequestOptions,
  ): Promise<PayoutExportAccepted>;
  /** Disbursement readiness. Rail entries carry NO `config`. */
  connectStatus(params?: Params, options?: RequestOptions): Promise<PayoutConnectStatus>;
  /** How a partner EARNS. */
  rules: PayoutRulesClient;
  /** How money physically LEAVES. */
  rails: PayoutRailsClient;
  /** One frozen disbursement run. */
  batches: PayoutBatchesClient;
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
  PayoutRulesRequiredError,
  PayoutRailRequiredError,
  PayoutRailAlreadyExistsError,
  ImmutableParameterError,
  PayoutBatchEmptyError,
  PayoutBatchStateError,
  ConflictingParametersError,
  WebhookSignatureVerificationError,
  type BoominErrorCode,
} from "./errors.js";
