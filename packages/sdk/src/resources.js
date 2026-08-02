/**
 * The 12 resource clients of @boomin/sdk (spec: DISTRIBUTION_CORE §4).
 *
 * Conventions:
 * - every method's trailing argument is per-call RequestOptions
 *   ({ idempotencyKey, brand, timeout, maxRetries });
 * - list endpoints return a list promise that is also `for await`-iterable;
 * - mutations are POSTs (POST-update API) and auto-carry an Idempotency-Key.
 */

import { BoominError } from "./errors.js";
import { makeListPromise, pathParam } from "./core.js";

const TERMINAL_OPERATION_STATUSES = new Set(["succeeded", "partial", "failed", "canceled"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  constructor(http, segment) {
    super(http);
    this._segment = segment;
  }

  _base(programId) {
    return `/programs/${pathParam(programId, "programId")}/${this._segment}`;
  }

  create(programId, params, options) {
    return this._http.post(this._base(programId), params, options);
  }

  retrieve(programId, id, options) {
    return this._http.get(`${this._base(programId)}/${pathParam(id, "id")}`, undefined, options);
  }

  update(programId, id, params, options) {
    return this._http.post(`${this._base(programId)}/${pathParam(id, "id")}`, params, options);
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
  constructor(http, segment) {
    super(http);
    this._segment = segment;
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
    );
  }
}

export class ProgramsClient extends ResourceClient {
  constructor(http) {
    super(http);
    this.requirements = new ProgramSubcollection(http, "requirements");
    this.tiers = new ProgramSubcollection(http, "tiers");
    this.connectConfig = new ProgramConfig(http, "connect_config");
    this.handoffConfig = new ProgramConfig(http, "handoff_config");
  }

  create(params, options) {
    return this._http.post("/programs", params, options);
  }

  retrieve(id, options) {
    return this._http.get(`/programs/${pathParam(id, "id")}`, undefined, options);
  }

  update(id, params, options) {
    return this._http.post(`/programs/${pathParam(id, "id")}`, params, options);
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
    return this._http.post(`/partnerships/${pathParam(id, "id")}/permissions`, params, options);
  }
}

export class EnrollmentsClient extends ResourceClient {
  /** Invite: creates the enrollment (payload carries `program`). */
  create(params, options) {
    return this._http.post("/enrollments", params, options);
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
    return this._http.post("/distributions", params, options);
  }

  retrieve(id, options) {
    return this._http.get(`/distributions/${pathParam(id, "id")}`, undefined, options);
  }

  /** Allowed in draft|ready; any update invalidates validation (back to draft). */
  update(id, params, options) {
    return this._http.post(`/distributions/${pathParam(id, "id")}`, params, options);
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
    return this._http.post("/performance/events", params, options);
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
  retrieve(id, options) {
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
   */
  async wait(id, { timeout = 60000, pollInterval = 1000, ...options } = {}) {
    const startedAt = Date.now();
    for (;;) {
      const operation = await this.retrieve(id, options);
      if (operation && TERMINAL_OPERATION_STATUSES.has(operation.status)) return operation;
      const elapsed = Date.now() - startedAt;
      if (elapsed + pollInterval > timeout) {
        throw new BoominError(
          `Operation ${id} did not reach a terminal status within ${timeout}ms ` +
            `(last status: ${operation?.status ?? "unknown"}).`,
          { code: "operation_wait_timeout" },
        );
      }
      await sleep(pollInterval);
    }
  }
}

class WebhookEndpointsClient extends ResourceClient {
  create(params, options) {
    return this._http.post("/webhook_endpoints", params, options);
  }

  retrieve(id, options) {
    return this._http.get(`/webhook_endpoints/${pathParam(id, "id")}`, undefined, options);
  }

  update(id, params, options) {
    return this._http.post(`/webhook_endpoints/${pathParam(id, "id")}`, params, options);
  }

  list(params, options) {
    return this._list("/webhook_endpoints", params, options);
  }

  /** Installs a fresh signing secret (revealed once in this response); the
   * previous secret stays honored for a rotation overlap window. */
  rotateSecret(id, params, options) {
    return this._http.post(
      `/webhook_endpoints/${pathParam(id, "id")}/rotate_secret`,
      params ?? {},
      options,
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
    return this._http.post("/payouts/run", params ?? {}, options);
  }

  /** Export eligible payouts on the csv_batch rail. */
  exportCsv(params, options) {
    return this._http.post("/payouts/export_csv", params ?? {}, options);
  }

  /** Stripe Connect payout-account status for the brand's partners. */
  connectStatus(params, options) {
    return this._http.get("/payouts/connect_status", params, options);
  }
}
