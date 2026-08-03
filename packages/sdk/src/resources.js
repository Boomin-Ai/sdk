/**
 * The 12 resource clients of @boomin/sdk (spec: DISTRIBUTION_CORE §4).
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
}

export class PartnersClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/partners/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/partners", params, options);
  }
}

export class PartnershipsClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/partnerships/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/partnerships", params, options);
  }

  pause(id, params, options) {
    return this._http.post(`/partnerships/${pathParam(id, "id")}/pause`, params ?? {}, options);
  }

  resume(id, params, options) {
    return this._http.post(`/partnerships/${pathParam(id, "id")}/resume`, params ?? {}, options);
  }

  end(id, params, options) {
    return this._http.post(`/partnerships/${pathParam(id, "id")}/end`, params ?? {}, options);
  }

  updatePermissions(id, params, options) {
    return this._http.post(
      `/partnerships/${pathParam(id, "id")}/permissions`,
      params,
      options,
      "partnerships.updatePermissions",
    );
  }
}

export class EnrollmentsClient extends ResourceClient {
  /** Invite: creates the enrollment (payload carries `program`). */
  create(params, options) {
    return this._http.post("/enrollments", params, options, "enrollments.create");
  }

  retrieve(id, options) {
    return this._http.get(`/enrollments/${pathParam(id, "id")}`, undefined, options);
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

class PayoutBatchesClient extends ResourceClient {
  retrieve(id, options) {
    return this._http.get(`/payouts/batches/${pathParam(id, "id")}`, undefined, options);
  }

  list(params, options) {
    return this._list("/payouts/batches", params, options);
  }
}

export class PayoutsClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.batches = new PayoutBatchesClient(http);
  }

  list(params, options) {
    return this._list("/payouts", params, options);
  }

  /** Run disbursement over eligible payouts — returns a batch + operation. */
  run(params, options) {
    return this._http.post("/payouts/run", params ?? {}, options, "payouts.run");
  }

  /** Export eligible payouts on the csv_batch rail. */
  exportCsv(params, options) {
    return this._http.post("/payouts/export_csv", params ?? {}, options, "payouts.exportCsv");
  }

  /** Stripe Connect payout-account status for the brand's partners. */
  connectStatus(params, options) {
    return this._http.get("/payouts/connect_status", params, options);
  }
}
