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
  PartnersClient,
  PartnershipsClient,
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
   *           timeout?: number, fetch?: typeof fetch }} [options]
   */
  constructor(secretKey, options = {}) {
    this._http = new HttpClient(secretKey, options);

    this.programs = new ProgramsClient(this._http);
    this.partners = new PartnersClient(this._http);
    this.partnerships = new PartnershipsClient(this._http);
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
}

export default Boomin;

export { constructEvent } from "./webhooks.js";
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
} from "./errors.js";
