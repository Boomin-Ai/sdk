/**
 * The 15 resource clients of @boomin/sdk (DISTRIBUTION_CORE §4 +
 * RELATIONSHIP_CORE §2/§4/§5).
 *
 * Conventions:
 * - every method's trailing argument is per-call RequestOptions
 *   ({ idempotencyKey, brand, timeout, maxRetries });
 * - list endpoints return a list promise that is also `for await`-iterable;
 * - mutations are POSTs (POST-update API) and auto-carry an Idempotency-Key.
 */

import { BoominError, InvalidRequestError } from "./errors.js";
import { makeListPromise, pathParam } from "./core.js";

const TERMINAL_OPERATION_STATUSES = new Set(["succeeded", "partial", "failed", "canceled"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Accept either an operation id string or anything carrying one on `.id`.
 *
 * `distributions.launch` resolves `{ distribution, status, operation }` where
 * BOTH refs are id STRINGS — but `pause`/`resume`/`cancel` resolve a full
 * object with `operation` alongside, and a caller who already holds an
 * Operation should not have to unwrap it. Forgiving both readings costs one
 * function and removes the single most-copied broken line in the docs.
 */
function operationRef(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  throw new InvalidRequestError(
    "An operation id is required: pass the `operation` from a launch/pause/resume/cancel " +
      "response (an id string) or an operation object. " +
      `Got ${value === null ? "null" : typeof value}.`,
    { code: "invalid_request" },
  );
}

class ResourceClient {
  constructor(http) {
    this._http = http;
  }

  _list(path, params, options) {
    return makeListPromise(
      (pageParams) => this._http.get(path, pageParams, options),
      params ?? {},
    );
  }
}

/** Nested collection under /programs/:id (requirements, tiers). */
class ProgramSubcollection extends ResourceClient {
  /** @param {string} shape REQUEST_FIELD_MAP prefix (see casing.js). */
  constructor(http, segment, shape) {
    super(http);
    this._segment = segment;
    this._shape = shape;
  }

  _base(programId) {
    return `/programs/${pathParam(programId, "programId")}/${this._segment}`;
  }

  create(programId, params, options) {
    return this._http.post(this._base(programId), params, options, `programs.${this._shape}.create`);
  }

  retrieve(programId, id, options) {
    return this._http.get(`${this._base(programId)}/${pathParam(id, "id")}`, undefined, options);
  }

  update(programId, id, params, options) {
    return this._http.post(
      `${this._base(programId)}/${pathParam(id, "id")}`,
      params,
      options,
      `programs.${this._shape}.update`,
    );
  }

  list(programId, params, options) {
    return this._list(this._base(programId), params, options);
  }

  del(programId, id, options) {
    return this._http.delete(`${this._base(programId)}/${pathParam(id, "id")}`, options);
  }
}

/** Singleton config nested under /programs/:id (connect_config, handoff_config). */
class ProgramConfig extends ResourceClient {
  /** @param {string} shape REQUEST_FIELD_MAP prefix (see casing.js). */
  constructor(http, segment, shape) {
    super(http);
    this._segment = segment;
    this._shape = shape;
  }

  retrieve(programId, options) {
    return this._http.get(
      `/programs/${pathParam(programId, "programId")}/${this._segment}`,
      undefined,
      options,
    );
  }

  update(programId, params, options) {
    return this._http.post(
      `/programs/${pathParam(programId, "programId")}/${this._segment}`,
      params,
      options,
      `programs.${this._shape}.update`,
    );
  }
}

export class ProgramsClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.requirements = new ProgramSubcollection(http, "requirements", "requirements");
    this.tiers = new ProgramSubcollection(http, "tiers", "tiers");
    this.connectConfig = new ProgramConfig(http, "connect_config", "connectConfig");
    this.handoffConfig = new ProgramConfig(http, "handoff_config", "handoffConfig");
  }

  create(params, options) {
    return this._http.post("/programs", params, options, "programs.create");
  }

  retrieve(id, options) {
    return this._http.get(`/programs/${pathParam(id, "id")}`, undefined, options);
  }

  update(id, params, options) {
    return this._http.post(`/programs/${pathParam(id, "id")}`, params, options, "programs.update");
  }

  list(params, options) {
    return this._list("/programs", params, options);
  }

  /**
   * Read-only standing preview (`programs:read`). No params = the
   * whole-program reporting shape. `{ enrollment }` targets one member
   * through the evaluator's exact read half; `{ enrollment, simulate }`
   * overlays what-ifs — `simulate.assertions` claims (null = simulate
   * absence) and/or `simulate.operatingType` (null = simulate untyped) —
   * persisting NOTHING. The contract behind `boomin standing test`.
   */
  standingPreview(id, params, options) {
    return this._http.post(
      `/programs/${pathParam(id, "id")}/standing_preview`,
      params ?? {},
      options,
      "programs.standingPreview",
    );
  }
}

/** Canonical since RELATIONSHIP_CORE: an ENTITY is who you have relationships
 *  with. `boomin.partners` delegates here (old `ptnr_` ids decode forever). */
export class EntitiesClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/entities/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/entities", params, options);
  }
}

/** Canonical since RELATIONSHIP_CORE: the durable pair-level bond.
 *  `boomin.partnerships` delegates here (old `pship_` ids decode forever). */
export class RelationshipsClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/relationships/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/relationships", params, options);
  }

  pause(id, params, options) {
    return this._http.post(`/relationships/${pathParam(id, "id")}/pause`, params ?? {}, options);
  }

  resume(id, params, options) {
    return this._http.post(`/relationships/${pathParam(id, "id")}/resume`, params ?? {}, options);
  }

  end(id, params, options) {
    return this._http.post(`/relationships/${pathParam(id, "id")}/end`, params ?? {}, options);
  }

  updatePermissions(id, params, options) {
    return this._http.post(
      `/relationships/${pathParam(id, "id")}/permissions`,
      params,
      options,
      "relationships.updatePermissions",
    );
  }
}

/**
 * Tenant truth (RELATIONSHIP_CORE §4). Assertions are CLAIM-addressed — you
 * assert or revoke `(subject, key)`, never an `asrt_` event id (events are the
 * immutable history; `retrieveEvent` reads one). The subject is `entity` OR
 * `externalUserId`+`issuer` — the same pair a signed handoff binds.
 */
export class AssertionsClient extends ResourceClient {
  /** Assert (create/refresh) a claim. Re-asserting the same value with a new
   *  `expiresAt` extends it — a refreshed expiry is a new event. */
  create(params, options) {
    return this._http.post("/assertions", params, options, "assertions.create");
  }

  /** Revoke by claim address — `{entity | externalUserId+issuer, key}`. */
  revoke(params, options) {
    return this._http.post("/assertions/revoke", params, options, "assertions.revoke");
  }

  /** Current claims for one subject (`entity` or `externalUserId`+`issuer`). */
  list(params, options) {
    return this._list("/assertions", params, options);
  }

  /** One immutable assertion EVENT by `asrt_…` id. */
  retrieveEvent(id, options) {
    return this._http.get(`/assertions/${pathParam(id, "id")}`, undefined, options);
  }
}

/** Contextual capacity vocabulary (§2): brand words like advisor / reseller.
 *  Keys are non-recyclable — archive stops NEW assignment; reactivate via
 *  `update(id, { status: "active" })`, never a second create. */
export class OperatingTypesClient extends ResourceClient {
  create(params, options) {
    return this._http.post("/operating_types", params, options, "operatingTypes.create");
  }

  /** Accepts `otype_…` or the brand-scoped KEY (`"advisor"`). */
  retrieve(id, options) {
    return this._http.get(`/operating_types/${pathParam(id, "id")}`, undefined, options);
  }

  update(id, params, options) {
    return this._http.post(`/operating_types/${pathParam(id, "id")}`, params, options, "operatingTypes.update");
  }

  list(params, options) {
    return this._list("/operating_types", params, options);
  }

  /** Archive — the key survives forever; never recycled. */
  archive(id, options) {
    return this._http.delete(`/operating_types/${pathParam(id, "id")}`, options);
  }
}

/** Tenant metric vocabulary (§4/§5, mig 0132): registered `x:` keys. The LIST
 *  also carries the built-ins flagged `builtin: true`. Vocabulary ≠ capability:
 *  standing/reward admit `x:`, payout stays built-ins-only in v1. */
export class MetricKeysClient extends ResourceClient {
  create(params, options) {
    return this._http.post("/metric_keys", params, options, "metricKeys.create");
  }

  /** Accepts `mkey_…`, the `x:` key itself, or a built-in key (synthetic). */
  retrieve(id, options) {
    return this._http.get(`/metric_keys/${pathParam(id, "id")}`, undefined, options);
  }

  update(id, params, options) {
    return this._http.post(`/metric_keys/${pathParam(id, "id")}`, params, options, "metricKeys.update");
  }

  list(params, options) {
    return this._list("/metric_keys", params, options);
  }

  /** Archive — non-recyclable; reactivate the SAME row via update. */
  archive(id, options) {
    return this._http.delete(`/metric_keys/${pathParam(id, "id")}`, options);
  }
}

/** Negotiated per-enrollment terms (§5) under /enrollments/:id/requirement_overrides. */
class EnrollmentOverridesClient extends ResourceClient {
  _base(enrollmentId) {
    return `/enrollments/${pathParam(enrollmentId, "enrollmentId")}/requirement_overrides`;
  }

  create(enrollmentId, params, options) {
    return this._http.post(this._base(enrollmentId), params, options, "enrollments.requirementOverrides.create");
  }

  retrieve(enrollmentId, id, options) {
    return this._http.get(`${this._base(enrollmentId)}/${pathParam(id, "id")}`, undefined, options);
  }

  update(enrollmentId, id, params, options) {
    return this._http.post(
      `${this._base(enrollmentId)}/${pathParam(id, "id")}`,
      params,
      options,
      "enrollments.requirementOverrides.update",
    );
  }

  list(enrollmentId, params, options) {
    return this._list(this._base(enrollmentId), params, options);
  }

  /** DELETE = archive (history stays readable; the merge stops applying it). */
  del(enrollmentId, id, options) {
    return this._http.delete(`${this._base(enrollmentId)}/${pathParam(id, "id")}`, options);
  }
}

export class EnrollmentsClient extends ResourceClient {
  constructor(http) {
    super(http);
    /** Negotiated per-enrollment terms (§5): patch / disable / add. */
    this.requirementOverrides = new EnrollmentOverridesClient(http);
  }

  /** Invite: creates the enrollment (payload carries `program`). */
  create(params, options) {
    return this._http.post("/enrollments", params, options, "enrollments.create");
  }

  retrieve(id, options) {
    return this._http.get(`/enrollments/${pathParam(id, "id")}`, undefined, options);
  }

  /** Update — notably `operatingType` (a key like `"advisor"`, or null to
   *  clear the capacity). Archived types cannot be newly assigned. */
  update(id, params, options) {
    return this._http.post(`/enrollments/${pathParam(id, "id")}`, params, options, "enrollments.update");
  }

  list(params, options) {
    return this._list("/enrollments", params, options);
  }

  approve(id, params, options) {
    return this._http.post(`/enrollments/${pathParam(id, "id")}/approve`, params ?? {}, options);
  }

  reject(id, params, options) {
    return this._http.post(`/enrollments/${pathParam(id, "id")}/reject`, params ?? {}, options);
  }

  pause(id, params, options) {
    return this._http.post(`/enrollments/${pathParam(id, "id")}/pause`, params ?? {}, options);
  }

  /** `resume` is the canonical verb on every surface — never `unpause`. */
  resume(id, params, options) {
    return this._http.post(`/enrollments/${pathParam(id, "id")}/resume`, params ?? {}, options);
  }
}

export class DistributionsClient extends ResourceClient {
  /** Creates a distribution in `draft`. */
  create(params, options) {
    return this._http.post("/distributions", params, options, "distributions.create");
  }

  retrieve(id, options) {
    return this._http.get(`/distributions/${pathParam(id, "id")}`, undefined, options);
  }

  /** Allowed in draft|ready; any update invalidates validation (back to draft). */
  update(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}`, params, options, "distributions.update");
  }

  list(params, options) {
    return this._list("/distributions", params, options);
  }

  validate(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}/validate`, params ?? {}, options);
  }

  /**
   * Launch is always async: resolves the 202 body
   * `{ distribution, status: 'launching', operation }` — never a synchronous
   * success. Follow the operation (`boomin.operations.wait`) for the outcome.
   */
  launch(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}/launch`, params ?? {}, options);
  }

  pause(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}/pause`, params ?? {}, options);
  }

  resume(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}/resume`, params ?? {}, options);
  }

  cancel(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}/cancel`, params ?? {}, options);
  }
}

export class DeploymentsClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/deployments/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/deployments", params, options);
  }

  pause(id, params, options) {
    return this._http.post(`/deployments/${pathParam(id, "id")}/pause`, params ?? {}, options);
  }

  /** `resume` is the canonical verb on every surface — never `unpause`. */
  resume(id, params, options) {
    return this._http.post(`/deployments/${pathParam(id, "id")}/resume`, params ?? {}, options);
  }

  cancel(id, params, options) {
    return this._http.post(`/deployments/${pathParam(id, "id")}/cancel`, params ?? {}, options);
  }
}

export class ConnectionsClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/connections/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/connections", params, options);
  }

  revoke(id, params, options) {
    return this._http.post(`/connections/${pathParam(id, "id")}/revoke`, params ?? {}, options);
  }
}

class PerformanceEventsClient extends ResourceClient {
  /** Business measurement ingestion (performance:write) — events IN. */
  create(params, options) {
    return this._http.post("/performance/events", params, options, "performance.events.create");
  }
}

export class PerformanceClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.events = new PerformanceEventsClient(http);
  }

  summary(params, options) {
    return this._http.get("/performance/summary", params, options);
  }
}

export class EventsClient extends ResourceClient {
  /** The operational domain-event feed (events:read) — events OUT. */
  list(params, options) {
    return this._list("/events", params, options);
  }
}

export class OperationsClient extends ResourceClient {
  /** Accepts an operation id string or an operation object. */
  retrieve(idOrOperation, options) {
    const id = operationRef(idOrOperation);
    return this._http.get(`/operations/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/operations", params, options);
  }

  /**
   * Poll an operation until it reaches a terminal status
   * (succeeded | partial | failed | canceled) and return it — inspect
   * `operation.status` yourself; wait() does not throw on failed operations.
   * Throws BoominError code `operation_wait_timeout` when `timeout` elapses.
   *
   * Accepts an operation id string OR an operation object, because `launch`
   * hands back an id string while `pause`/`resume`/`cancel` hand back an
   * object — both readings must work.
   */
  async wait(idOrOperation, { timeout = 60000, pollInterval = 1000, ...options } = {}) {
    const id = operationRef(idOrOperation);
    const startedAt = Date.now();
    for (;;) {
      const operation = await this.retrieve(id, options);
      if (operation && TERMINAL_OPERATION_STATUSES.has(operation.status)) return operation;
      const elapsed = Date.now() - startedAt;
      if (elapsed + pollInterval > timeout) {
        // `waiting_reason` is the whole diagnosis when an operation parks
        // (funding_required, provider_review, …) — a timeout that hides it
        // sends the caller looking in the wrong place entirely.
        const waitingReason = operation?.waitingReason ?? operation?.waiting_reason;
        const reason = waitingReason ? ` (${waitingReason})` : "";
        throw new BoominError(
          `Operation ${id} did not reach a terminal status within ${timeout}ms ` +
            `(last status: ${operation?.status ?? "unknown"}${reason}).`,
          { code: "operation_wait_timeout" },
        );
      }
      await sleep(pollInterval);
    }
  }
}

/**
 * `webhook_endpoints` is the ONE v1 family whose single-object responses come
 * wrapped as `{ webhook_endpoint: {...} }` while every other resource returns
 * the object bare. Unwrap it here so the client is uniform — otherwise the
 * documented `const { secret } = await endpoints.create(...)` yields undefined,
 * and since the signing secret is revealed exactly once, it is then
 * unrecoverable without a rotation the caller does not know they need.
 *
 * Reads `webhookEndpoint` (the converted default) and `webhook_endpoint` (raw
 * mode), and tolerates a bare object so an un-wrapping API stays compatible.
 */
const unwrapEndpoint = (response) =>
  (response &&
    typeof response === "object" &&
    (response.webhookEndpoint ?? response.webhook_endpoint)) ||
  response;

class WebhookEndpointsClient extends ResourceClient {
  async create(params, options) {
    return unwrapEndpoint(
      await this._http.post("/webhook_endpoints", params, options, "webhooks.endpoints.create"),
    );
  }

  async retrieve(id, options) {
    return unwrapEndpoint(
      await this._http.get(`/webhook_endpoints/${pathParam(id, "id")}`, undefined, options),
    );
  }

  async update(id, params, options) {
    return unwrapEndpoint(
      await this._http.post(
        `/webhook_endpoints/${pathParam(id, "id")}`,
        params,
        options,
        "webhooks.endpoints.update",
      ),
    );
  }

  list(params, options) {
    return this._list("/webhook_endpoints", params, options);
  }

  /** Installs a fresh signing secret (revealed once in this response); the
   * previous secret stays honored for a rotation overlap window. */
  async rotateSecret(id, params, options) {
    return unwrapEndpoint(
      await this._http.post(
        `/webhook_endpoints/${pathParam(id, "id")}/rotate_secret`,
        params ?? {},
        options,
      ),
    );
  }

  del(id, options) {
    return this._http.delete(`/webhook_endpoints/${pathParam(id, "id")}`, options);
  }
}

export class WebhooksClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.endpoints = new WebhookEndpointsClient(http);
  }
}

/**
 * `payouts.rules` — how a partner EARNS.
 *
 * Nested under `payouts` on purpose. Distribution is the flagship primitive and
 * payouts is one supporting system; rules, rails and batches are PARTS of it,
 * not three more top-level nouns competing with it. The REST tree is nested the
 * same way (`/payouts/rules`), so the client mirrors the URL.
 */
class PayoutRulesClient extends ResourceClient {
  /**
   * Create a rule. `scope` is a discriminated object
   * (`{ type: "program"|"collection"|"unit"|"member", program, … }`), never a
   * raw applies_to/scope_id pair — an incoherent combination cannot be spelled.
   * Money is `perUnitMinor` / `bonusMinor` (minor units of the rule's
   * `currency`), never cents.
   */
  create(params, options) {
    return this._http.post("/payouts/rules", params, options, "payouts.rules.create");
  }

  retrieve(id, options) {
    return this._http.get(`/payouts/rules/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/payouts/rules", params, options);
  }

  /**
   * Update — `name` and `status` ONLY.
   *
   * A rule's economics are immutable after creation: the payouts ledger
   * references the rule that produced each row, so editing a rate would
   * re-interpret settled history. Sending one throws `ImmutableParameterError`
   * naming the frozen concept. To change money, create a replacement rule,
   * activate it, then `archive` this one.
   */
  update(id, params, options) {
    return this._http.post(`/payouts/rules/${pathParam(id, "id")}`, params, options, "payouts.rules.update");
  }

  /**
   * Archive — the "remove this rule" verb, and deliberately NOT `del()`.
   *
   * `payouts.rule_id` cascades on delete, so a hard delete would take every
   * ledger row the rule ever produced with it: the money would still have been
   * paid and the record of why would be gone. Archiving stops the rule firing
   * on the next run and leaves history readable. Idempotent.
   */
  archive(id, params, options) {
    return this._http.post(
      `/payouts/rules/${pathParam(id, "id")}/archive`,
      params ?? {},
      options,
      "payouts.rules.archive",
    );
  }
}

/**
 * `payouts.rails` — how money physically LEAVES.
 *
 * `config.columns` is YOUR data: the SDK sends it and reads it back
 * byte-for-byte, headers and order intact (see casing.js). `config.format` and
 * `config.walletFunded` are the API's and convert like any other field.
 */
class PayoutRailsClient extends ResourceClient {
  /**
   * Create — NOT an upsert. A second create for a configured rail throws
   * `PayoutRailAlreadyExistsError`, so a call that reads as "add a rail" can
   * never silently rewrite where money lands. Use `update` explicitly.
   */
  create(params, options) {
    return this._http.post("/payouts/rails", params, options, "payouts.rails.create");
  }

  retrieve(id, options) {
    return this._http.get(`/payouts/rails/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/payouts/rails", params, options);
  }

  /**
   * Update. `config` REPLACES the stored object wholesale — there is no merge,
   * because a merge cannot express "remove this key" and a half-applied column
   * mapping is a file that pays the wrong column.
   */
  update(id, params, options) {
    return this._http.post(`/payouts/rails/${pathParam(id, "id")}`, params, options, "payouts.rails.update");
  }
}

/** `payouts.batches` — one frozen disbursement run. */
class PayoutBatchesClient extends ResourceClient {
  /**
   * Build (freeze) a batch over the eligible rows — SYNCHRONOUS, resolving the
   * batch plus its `items` and `skipped`. Omit `rail` to use the brand's
   * default rail; with none configured this throws `PayoutRailRequiredError`.
   */
  create(params, options) {
    return this._http.post("/payouts/batches", params ?? {}, options, "payouts.batches.create");
  }

  /**
   * Retrieve — and the home of `downloadUrl`, which is re-minted on every read
   * of a batch that has an artifact. A URL returned once by `export` would
   * already be expiring by the time an operator opened it.
   */
  retrieve(id, options) {
    return this._http.get(`/payouts/batches/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/payouts/batches", params, options);
  }

  /**
   * Export the batch's file to storage — 202, resolving
   * `{ batch, status: "exporting", operation }` as id STRINGS. Follow the
   * operation (`boomin.operations.wait`), then read the batch for `downloadUrl`.
   * Repeating the call replays the same operation and the same object key: one
   * batch can never produce two artifacts.
   */
  export(id, params, options) {
    return this._http.post(
      `/payouts/batches/${pathParam(id, "id")}/export`,
      params ?? {},
      options,
      "payouts.batches.export",
    );
  }

  /**
   * Record the outcome of a disbursement — 202,
   * `{ batch, status: "confirming", operation }`.
   *
   * An Operation because the work is unbounded: item count has no cap and each
   * item settles individually (plus a guarded wallet debit each when the rail
   * is `walletFunded`), which would exceed a Worker's subrequest budget and die
   * mid-settlement. Repeating a confirm with the SAME `externalBatchRef`
   * replays one operation, so a retry after a timeout cannot settle twice.
   */
  confirm(id, params, options) {
    return this._http.post(
      `/payouts/batches/${pathParam(id, "id")}/confirm`,
      params ?? {},
      options,
      "payouts.batches.confirm",
    );
  }

  /** Cancel (unfreeze) a batch — synchronous, resolves the batch. */
  cancel(id, params, options) {
    return this._http.post(
      `/payouts/batches/${pathParam(id, "id")}/cancel`,
      params ?? {},
      options,
      "payouts.batches.cancel",
    );
  }
}

export class PayoutsClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.rules = new PayoutRulesClient(http);
    this.rails = new PayoutRailsClient(http);
    this.batches = new PayoutBatchesClient(http);
  }

  list(params, options) {
    return this._list("/payouts", params, options);
  }

  /**
   * Recompute the period's payout rows.
   *
   * Resolves `{ outcome, rules_evaluated…, payouts, summary }`: branch on
   * `outcome` (`"payouts_created"` | `"no_eligible_activity"`), never on a
   * count. A brand with no active rule and no active split throws
   * `PayoutRulesRequiredError` (409) instead of answering zero — "misconfigured"
   * and "nothing owed" are different answers and used to be the same one.
   */
  run(params, options) {
    return this._http.post("/payouts/run", params ?? {}, options, "payouts.run");
  }

  /**
   * Build + export in one call on the csv_batch rail — 202, resolving
   * `{ batch, status: "exporting", operation, items, skipped }` where `batch`
   * and `operation` are id STRINGS.
   *
   * The build half is synchronous, so `PayoutRailRequiredError` and
   * `PayoutBatchEmptyError` still come back immediately and typed. The download
   * URL is NOT here: follow the operation, then read
   * `payouts.batches.retrieve(batch).downloadUrl`.
   */
  exportCsv(params, options) {
    return this._http.post("/payouts/export_csv", params ?? {}, options, "payouts.exportCsv");
  }

  /**
   * Disbursement readiness: rails (identity and state only) + the Stripe
   * Connect account rollup. Rail `config` is NOT here — it is a
   * `payout_rails:read` surface, because a column mapping decides where money
   * lands. Read it with `payouts.rails.list()`.
   */
  connectStatus(params, options) {
    return this._http.get("/payouts/connect_status", params, options);
  }
}
