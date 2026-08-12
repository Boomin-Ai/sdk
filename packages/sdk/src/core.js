/**
 * Internal HTTP core for @boomin/sdk.
 *
 * fetch + WebCrypto only — safe on Node >= 18, Cloudflare Workers, Bun, Deno,
 * and browsers/edge runtimes. No Node builtin imports anywhere in this package.
 */

import { APIError, AuthenticationError, InvalidRequestError, errorFromResponse } from "./errors.js";
import { buildQueryString, camelCaseResponse, snakeCaseBody } from "./casing.js";

// The casing boundary lives in ./casing.js — including REQUEST_FIELD_MAP, the
// declared list of nested API structures. Re-exported here because core.js is
// the module the SDK's internals (and its tests) already import from.
export {
  buildQueryString,
  camelCaseResponse,
  snakeCaseBody,
  toCamelKey,
  toSnakeKey,
  OPAQUE_FIELDS,
  REQUEST_FIELD_MAP,
  RESPONSE_FIELD_MAP,
} from "./casing.js";

export const SDK_VERSION = "1.0.0-beta.4";
export const DEFAULT_BASE_URL = "https://api.boomin.ai";
export const API_PREFIX = "/v1/platform";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8000;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Validate + encode a path segment (resource id). */
export function pathParam(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidRequestError(
      `${name} must be a non-empty string, got ${value === "" ? "an empty string" : typeof value}.`,
      { code: "invalid_request" },
    );
  }
  return encodeURIComponent(value);
}

function computeBackoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30000);
    }
  }
  const base = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter in [0.75, 1.25) of the base delay.
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}

export class HttpClient {
  constructor(secretKey, options = {}) {
    if (typeof secretKey !== "string" || secretKey.trim() === "") {
      throw new AuthenticationError(
        "A Boomin secret key is required: new Boomin('sk_live_...'). " +
          "Keys live in the Boomin console under Developer > API keys.",
        { code: "authentication_failed" },
      );
    }
    this.secretKey = secretKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.brand = options.brand ?? null;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    // Escape hatch: hand back the wire's snake_case objects untouched. This is a
    // CLIENT-level switch, not a per-call flag, on purpose — the return shape is
    // a property of the client, and a per-call override would make every
    // TypeScript signature in index.d.ts a lie at half the call sites. Use it
    // when you are proxying/logging Boomin responses verbatim.
    this.rawResponses = options.rawResponses === true;
    // Client marker sent as X-Boomin-Client on every request. Defaults to this
    // SDK's own identity; wrappers that drive the SDK (e.g. @boomin/cli) pass
    // their own so server-side adoption metrics attribute the real surface.
    this.clientHeader = typeof options.clientHeader === "string" && options.clientHeader.trim() !== ""
      ? options.clientHeader.trim()
      : `@boomin/sdk/${SDK_VERSION}`;
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new APIError(
        "Global fetch is not available in this runtime. @boomin/sdk requires Node >= 18, " +
          "a Workers/Bun/Deno runtime, or an explicit `fetch` option.",
        { code: "connection_error" },
      );
    }
  }

  /**
   * Perform one API request with retries, auto idempotency, and typed errors.
   *
   * @param {string} method HTTP verb.
   * @param {string} path Path under /v1/platform (must start with "/").
   * @param {{ query?: object, body?: object, options?: object, shape?: string }} [init]
   *   `shape` keys into REQUEST_FIELD_MAP (see casing.js) and decides which
   *   nested structures in the body get converted.
   */
  async request(method, path, { query, body, options = {}, shape } = {}) {
    const verb = method.toUpperCase();
    const url = `${this.baseUrl}${API_PREFIX}${path}${buildQueryString(query)}`;
    const timeout = options.timeout ?? this.timeout;
    const maxRetries = options.maxRetries ?? this.maxRetries;

    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: "application/json",
      "X-Boomin-Client": this.clientHeader,
    };
    const brand = options.brand ?? this.brand;
    if (brand) headers["Boomin-Brand"] = brand;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const isMutation = MUTATION_METHODS.has(verb);
    if (isMutation) {
      // Auto idempotency key on every mutation; stable across retries within
      // this call, overridable per-call via { idempotencyKey }.
      headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
    }
    // Safe verbs are idempotent by definition; mutations are idempotent
    // because they always carry an Idempotency-Key — so retries are safe.
    const retryable = !isMutation || headers["Idempotency-Key"] !== undefined;

    const requestInit = {
      method: verb,
      headers,
      // camelCase -> snake_case by declared schema (casing.js). Without it a
      // camelCase field was dropped by the API's schema and the call answered
      // 200 OK having done nothing: `enabledEvents` on webhook create landed as
      // `enabled_events: []`, which means SUBSCRIBE TO EVERY EVENT TYPE.
      // A camel/snake twin pair throws ConflictingParametersError right here,
      // before the request is issued.
      body: body !== undefined ? JSON.stringify(snakeCaseBody(body, shape)) : undefined,
    };

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(computeBackoffMs(attempt - 1, lastError?.retryAfter));

      let response;
      try {
        response = await this.#fetchWithTimeout(url, requestInit, timeout);
      } catch (cause) {
        const timedOut = cause?.name === "AbortError" || cause?.name === "TimeoutError";
        lastError = new APIError(
          timedOut
            ? `Request to ${url} timed out after ${timeout}ms.`
            : `Could not connect to ${url}: ${cause?.message ?? cause}`,
          { code: timedOut ? "request_timeout" : "connection_error", cause },
        );
        if (retryable && attempt < maxRetries) continue;
        throw lastError;
      }

      const requestId =
        response.headers.get("request-id") ?? response.headers.get("boomin-request-id");

      if (response.ok) {
        if (response.status === 204) return null;
        const text = await response.text();
        if (text === "") return null;
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (cause) {
          throw new APIError("Boomin API returned a malformed JSON response body.", {
            code: "internal_error",
            status: response.status,
            requestId,
            cause,
          });
        }
        // Casing is OUTSIDE the JSON try/catch on purpose: camelCaseResponse
        // throws ConflictingParametersError when the server sends both
        // spellings of one field, and that must surface as itself, not get
        // reported as malformed JSON.
        if (this.rawResponses) return parsed;
        try {
          // The wire is snake_case; the SDK is camelCase in BOTH directions.
          // Customer-owned blobs are exempt — see RESPONSE_FIELD_MAP/casing.js.
          return camelCaseResponse(parsed);
        } catch (cause) {
          if (cause?.code === "conflicting_parameters") {
            cause.status = response.status;
            cause.requestId = requestId;
          }
          throw cause;
        }
      }

      let parsedBody = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }
      const error = errorFromResponse(response.status, parsedBody, requestId);
      const shouldRetry =
        retryable && (response.status === 429 || response.status >= 500) && attempt < maxRetries;
      if (!shouldRetry) throw error;
      error.retryAfter = response.headers.get("retry-after");
      lastError = error;
    }
    // Unreachable, but keeps the control flow analyzable.
    throw lastError ?? new APIError("Request failed.", { code: "internal_error" });
  }

  get(path, query, options) {
    return this.request("GET", path, { query, options });
  }

  /** @param {string} [shape] Key into REQUEST_FIELD_MAP (see casing.js). */
  post(path, body, options, shape) {
    return this.request("POST", path, { body, options, shape });
  }

  delete(path, options) {
    return this.request("DELETE", path, { options });
  }

  async #fetchWithTimeout(url, init, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await this.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A promise for one page of a list that is also an async iterable over every
 * item across pages (cursor pagination via starting_after on the last item id).
 *
 * Reads BOTH `hasMore` (the converted default) and `has_more` (raw mode), so
 * auto-pagination works either way.
 *
 * @template T
 */
export function makeListPromise(fetchPage, params = {}) {
  const firstPage = fetchPage(params);
  return {
    then: (onFulfilled, onRejected) => firstPage.then(onFulfilled, onRejected),
    catch: (onRejected) => firstPage.catch(onRejected),
    finally: (onFinally) => firstPage.finally(onFinally),
    async *[Symbol.asyncIterator]() {
      let page = await firstPage;
      for (;;) {
        const data = Array.isArray(page?.data) ? page.data : [];
        for (const item of data) yield item;
        const hasMore = page?.hasMore ?? page?.has_more;
        if (!hasMore || data.length === 0) return;
        const last = data[data.length - 1];
        if (!last || typeof last.id !== "string") return;
        page = await fetchPage({ ...params, startingAfter: last.id });
      }
    },
  };
}
