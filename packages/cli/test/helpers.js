/** Shared CLI test helpers: a recording mock fetch (Response-shaped) and a
 * log capturer, mirroring packages/sdk/test/helpers.js. */

export function createMockFetch(script = [{ status: 200, body: {} }]) {
  const calls = [];
  const mock = async (url, init = {}) => {
    const step = script[Math.min(calls.length, script.length - 1)] ?? { status: 200, body: {} };
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    if (step.error) throw step.error;
    const status = step.status ?? 200;
    const headers = new Map(Object.entries(step.headers ?? {}));
    const text = step.body === undefined ? "" : JSON.stringify(step.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      text: async () => text,
      json: async () => JSON.parse(text || "null"),
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    };
  };
  mock.calls = calls;
  return mock;
}

export function createLogCapture() {
  const lines = [];
  const log = (...args) => lines.push(args.join(" "));
  log.lines = lines;
  log.text = () => lines.join("\n");
  return log;
}
