import test from "node:test";
import assert from "node:assert/strict";

import { createClient } from "./helpers.js";

// The WIRE envelope is snake_case; the SDK hands back `hasMore`.
const page = (ids, hasMore) => ({
  status: 200,
  body: { object: "list", data: ids.map((id) => ({ id })), has_more: hasMore },
});

test("awaiting a list resolves a single page envelope", async () => {
  const { boomin, calls } = createClient([page(["ptr_1", "ptr_2"], true)]);
  const result = await boomin.partners.list({ limit: 2 });
  assert.equal(result.object, "list");
  assert.equal(result.hasMore, true, "the wire's has_more is handed back as hasMore");
  assert.equal(result.has_more, undefined, "the snake_case spelling is gone from the result");
  assert.deepEqual(result.data.map((d) => d.id), ["ptr_1", "ptr_2"]);
  assert.equal(calls.length, 1, "awaiting must fetch exactly one page");
});

test("for await auto-paginates across pages via starting_after", async () => {
  const { boomin, calls } = createClient([
    page(["a", "b"], true),
    page(["c", "d"], true),
    page(["e"], false),
  ]);
  const seen = [];
  for await (const item of boomin.enrollments.list({ program: "prog_1", limit: 2 })) {
    seen.push(item.id);
  }
  assert.deepEqual(seen, ["a", "b", "c", "d", "e"]);
  assert.equal(calls.length, 3);
  const urls = calls.map((c) => c.url);
  assert.match(urls[0], /\/enrollments\?program=prog_1&limit=2$/);
  assert.match(urls[1], /starting_after=b/);
  assert.match(urls[2], /starting_after=d/);
  // original filters persist on every page
  assert.match(urls[2], /program=prog_1/);
});

test("iteration stops immediately when hasMore is false", async () => {
  const { boomin, calls } = createClient([page(["only"], false)]);
  const seen = [];
  for await (const item of boomin.events.list({ type: "distribution.live" })) seen.push(item.id);
  assert.deepEqual(seen, ["only"]);
  assert.equal(calls.length, 1);
});

test("empty first page yields nothing", async () => {
  const { boomin, calls } = createClient([page([], false)]);
  const seen = [];
  for await (const item of boomin.payouts.list()) seen.push(item.id);
  assert.deepEqual(seen, []);
  assert.equal(calls.length, 1);
});

test("early break stops fetching further pages", async () => {
  const { boomin, calls } = createClient([page(["a", "b"], true), page(["c"], true)]);
  for await (const item of boomin.partners.list()) {
    if (item.id === "a") break;
  }
  assert.equal(calls.length, 1);
});

test("list promise supports catch/finally", async () => {
  const { boomin } = createClient([{ status: 500, body: { error: { message: "x" } } }]);
  let finallyRan = false;
  const err = await boomin.partners
    .list()
    .catch((e) => e)
    .finally(() => {
      finallyRan = true;
    });
  assert.ok(err instanceof Error);
  assert.ok(finallyRan);
});
