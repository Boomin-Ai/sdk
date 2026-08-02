/** Shared test helpers: a recording mock fetch + client factory. */

import { Boomin } from "../src/index.js";

/**
 * Build a recording mock fetch.
 *
 * @param {Array<{ status?: number, body?: unknown, headers?: Record<string,string>, error?: Error }>} [script]
 *   Responses returned in order; the last entry repeats when exhausted.
 *   `{ error }` makes that call reject (network failure).
 */
export function createMockFetch(script = [{ status: 200, body: {} }]) {
  const calls = [];
  const mock = async (url, init = {}) => {
    const step = script[Math.min(calls.length, script.length - 1)] ?? { status: 200, body: {} };
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body ?? null,
      rawBody: init.body ?? null,
      signal: init.signal,
    });
    if (step.error) throw step.error;
    const status = step.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(step.body ?? {}), {
      status,
      headers: { "content-type": "application/json", ...(step.headers ?? {}) },
    });
  };
  mock.calls = calls;
  return mock;
}

export function createClient(script, options = {}) {
  const fetchMock = createMockFetch(script);
  const boomin = new Boomin(options.secretKey ?? "sk_test_abc123", {
    fetch: fetchMock,
    maxRetries: 0,
    ...options,
  });
  return { boomin, fetchMock, calls: fetchMock.calls };
}

export const lastCall = (calls) => calls[calls.length - 1];
