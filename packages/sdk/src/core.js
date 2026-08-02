/**
 * Internal HTTP core for @boomin/sdk.
 *
 * fetch + WebCrypto only — safe on Node >= 18, Cloudflare Workers, Bun, Deno,
 * and browsers/edge runtimes. No Node builtin imports anywhere in this package.
 */

import { APIError, AuthenticationError, InvalidRequestError, errorFromResponse } from "./errors.js";

export const SDK_VERSION = "1.0.0-beta.1";
export const DEFAULT_BASE_URL = "https://api.boomin.ai";
export const API_PREFIX = "/v1/platform";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8000;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const camelToSnake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Serialize query params. Top-level camelCase keys are converted to the API's
 * snake_case wire form (`startingAfter` -> `starting_after`); null/undefined
 * values are dropped; arrays repeat the key.
 */
export function buildQueryString(query) {
  if (!query || typeof query !== "object") return "";
  const search = new URLSearchParams();
  for (const [rawKey, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const key = camelToSnake(rawKey);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

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
   * @param {{ query?: object, body?: object, options?: object }} [init]
   */
  async request(method, path, { query, body, options = {} } = {}) {
    const verb = method.toUpperCase();
    const url = `${this.baseUrl}${API_PREFIX}${path}${buildQueryString(query)}`;
    const timeout = options.timeout ?? this.timeout;
    const maxRetries = options.maxRetries ?? this.maxRetries;

    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: "application/json",
      "X-Boomin-Client": `@boomin/sdk/${SDK_VERSION}`,
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
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
        try {
          return JSON.parse(text);
        } catch (cause) {
          throw new APIError("Boomin API returned a malformed JSON response body.", {
            code: "internal_error",
            status: response.status,
            requestId,
            cause,
          });
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

  post(path, body, options) {
    return this.request("POST", path, { body, options });
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
        if (!page?.has_more || data.length === 0) return;
        const last = data[data.length - 1];
        if (!last || typeof last.id !== "string") return;
        page = await fetchPage({ ...params, startingAfter: last.id });
      }
    },
  };
}
