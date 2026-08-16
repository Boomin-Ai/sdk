/**
 * @boomin/sdk — the Boomin platform SDK.
 *
 * ```js
 * import Boomin from "@boomin/sdk";
 *
 * const boomin = new Boomin("sk_live_...");
 * const distribution = await boomin.distributions.create({
 *   name: "Spring launch",
 *   objective: "acquisition",
 *   programs: ["prog_123"],
 * });
 * // `operation` is an id STRING; wait() also accepts an operation object.
 * const { operation } = await boomin.distributions.launch(distribution.id);
 * await boomin.operations.wait(operation, { timeout: 120000 });
 * ```
 *
 * fetch + WebCrypto only: Node >= 18, Cloudflare Workers, Bun, Deno, Edge.
 */

import { HttpClient, SDK_VERSION } from "./core.js";
import { constructEvent } from "./webhooks.js";
import {
  ProgramsClient,
  EntitiesClient,
  RelationshipsClient,
  AssertionsClient,
  OperatingTypesClient,
  MetricKeysClient,
  EnrollmentsClient,
  DistributionsClient,
  DeploymentsClient,
  ConnectionsClient,
  PerformanceClient,
  EventsClient,
  OperationsClient,
  WebhooksClient,
  PayoutsClient,
} from "./resources.js";

export class Boomin {
  /** Static webhook helpers: `Boomin.webhooks.constructEvent(payload, sig, secret)`. */
  static webhooks = { constructEvent };

  static VERSION = SDK_VERSION;

  /**
   * @param {string} secretKey Bearer secret key (`sk_live_...`).
   * @param {{ baseUrl?: string, brand?: string, maxRetries?: number,
   *           timeout?: number, rawResponses?: boolean, fetch?: typeof fetch }} [options]
   */
  constructor(secretKey, options = {}) {
    this._http = new HttpClient(secretKey, options);

    this.programs = new ProgramsClient(this._http);
    this.entities = new EntitiesClient(this._http);
    this.relationships = new RelationshipsClient(this._http);
    this.assertions = new AssertionsClient(this._http);
    this.operatingTypes = new OperatingTypesClient(this._http);
    this.metricKeys = new MetricKeysClient(this._http);
    this.enrollments = new EnrollmentsClient(this._http);
    this.distributions = new DistributionsClient(this._http);
    this.deployments = new DeploymentsClient(this._http);
    this.connections = new ConnectionsClient(this._http);
    this.performance = new PerformanceClient(this._http);
    this.events = new EventsClient(this._http);
    this.operations = new OperationsClient(this._http);
    this.webhooks = new WebhooksClient(this._http);
    this.payouts = new PayoutsClient(this._http);
  }

  /**
   * @deprecated RELATIONSHIP_CORE naming: use `boomin.entities`. Delegates to
   * the canonical client (requests go to `/entities`; old `ptnr_` ids decode
   * forever). Never removed.
   */
  get partners() {
    return this.entities;
  }

  /**
   * @deprecated RELATIONSHIP_CORE naming: use `boomin.relationships`.
   * Delegates to the canonical client (requests go to `/relationships`; old
   * `pship_` ids decode forever). Never removed.
   */
  get partnerships() {
    return this.relationships;
  }
}

export default Boomin;

export { constructEvent } from "./webhooks.js";
export {
  camelCaseResponse,
  snakeCaseBody,
  toCamelKey,
  toSnakeKey,
  OPAQUE_FIELDS,
  REQUEST_FIELD_MAP,
  RESPONSE_FIELD_MAP,
} from "./casing.js";
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
} from "./errors.js";
