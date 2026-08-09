/**
 * CLI 0.5.x — `program create|list|get|update`, the group that closes the
 * cold-start gap: the CLI could launch, pause, and pay out programs it could
 * not create. The flag surface mirrors the API's programCreateSchema exactly
 * (name required; type/description/visibility/metadata optional) — nothing
 * invented, so a flag that parses here is a field the API accepts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  programCreateParams,
  programUpdateParams,
  programSummary,
  runV1Command,
} from "../src/v1.js";
import { ApiError } from "../src/errors.js";
import { createMockFetch, createLogCapture } from "./helpers.js";

const TOKEN = "sk_boomin_live_test";
const BASE = "http://127.0.0.1:8791/v1/platform";

function flags(overrides = {}) {
  return { _: [], origins: [], ...overrides };
}

function run(group, subcommand, flagValues, fetchImpl, log) {
  return runV1Command(group, subcommand, flags(flagValues), {
    token: TOKEN,
    platformApiBase: BASE,
    fetch: fetchImpl,
    log,
  });
}

const pathOf = (call) => new URL(call.url).pathname;

// ── Flag → payload ────────────────────────────────────────────────────────────

test("programCreateParams mirrors programCreateSchema and requires --name", () => {
  assert.deepEqual(
    programCreateParams(flags({
      name: "Creator program",
      type: "performance",
      description: "Our creators",
      visibility: "listed",
      metadata: '{"tier":"gold"}',
    })),
    {
      name: "Creator program",
      type: "performance",
      description: "Our creators",
      visibility: "listed",
      metadata: { tier: "gold" },
    },
  );
  // Optional fields absent stay absent — the API's defaults are the defaults.
  assert.deepEqual(programCreateParams(flags({ name: "Bare" })), { name: "Bare" });
  assert.throws(() => programCreateParams(flags({})), /--name is required/);
  assert.throws(() => programCreateParams(flags({ name: "X", metadata: "{nope" })), /--metadata must be valid JSON/);
});

test("programUpdateParams rejects an empty patch before it reaches the API", () => {
  assert.deepEqual(
    programUpdateParams(flags({ status: "paused", visibility: "private" })),
    { status: "paused", visibility: "private" },
  );
  assert.throws(() => programUpdateParams(flags({})), /at least one of --name, --description, --status, --visibility, --metadata/);
});

// ── Output shaping ────────────────────────────────────────────────────────────

test("programSummary prints the id first and skips absent fields", () => {
  const text = programSummary({
    id: "prog_1",
    name: "Creator program",
    type: "performance",
    status: "active",
    visibility: "private",
    metadata: {},
  });
  assert.match(text, /^Program: prog_1/);
  assert.match(text, /Type: performance/);
  assert.ok(!/Metadata/.test(text), "empty metadata is not rendered");
  assert.ok(!/Description/.test(text), "absent description is not rendered");
});

// ── Wire behavior over a mocked transport ─────────────────────────────────────

test("program create posts the shaped payload and prints copy-pasteable next commands", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "prog_9", object: "program", name: "Creator program", type: "performance", status: "active", visibility: "private", created_at: "2026-08-09T00:00:00Z" } },
  ]);
  const log = createLogCapture();
  await run("program", "create", { name: "Creator program", type: "performance" }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/programs");
  assert.deepEqual(fetchImpl.calls[0].body, { name: "Creator program", type: "performance" });
  assert.ok(fetchImpl.calls[0].headers["Idempotency-Key"], "create carries an Idempotency-Key");
  assert.match(log.text(), /Program: prog_9/);
  // The id is what the operator types next — it must appear inside the
  // follow-up commands verbatim.
  assert.match(log.text(), /enrollment invite --program prog_9/);
  assert.match(log.text(), /distribution create --name "Launch" --programs prog_9/);
});

test("program create without --name fails before any request is made", async () => {
  const fetchImpl = createMockFetch();
  await assert.rejects(
    () => run("program", "create", {}, fetchImpl, createLogCapture()),
    /--name is required/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("program create --json prints the SDK's camelCase object", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "prog_9", object: "program", name: "P", status: "active", created_at: "2026-08-09T00:00:00Z" } },
  ]);
  const log = createLogCapture();
  await run("program", "create", { name: "P", json: true }, fetchImpl, log);
  assert.deepEqual(JSON.parse(log.text()), {
    id: "prog_9",
    object: "program",
    name: "P",
    status: "active",
    createdAt: "2026-08-09T00:00:00Z",
  });
});

test("program list renders the envelope as a table and pages with --starting-after", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", data: [{ id: "prog_1", status: "active", type: "performance", visibility: "listed", name: "Creators" }], has_more: true } },
  ]);
  const log = createLogCapture();
  await run("program", "list", { limit: "5", startingAfter: "prog_0" }, fetchImpl, log);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/v1/platform/programs");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("starting_after"), "prog_0");
  assert.match(log.text(), /prog_1\s+active\s+performance\s+listed\s+Creators/);
  assert.match(log.text(), /more — use --starting-after/);
});

test("program get retrieves by id and requires one", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { id: "prog_1", object: "program", name: "Creators", status: "active", visibility: "private" } },
  ]);
  const log = createLogCapture();
  await run("program", "get", { _: ["prog_1"] }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].method, "GET");
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/programs/prog_1");
  assert.match(log.text(), /Program: prog_1/);
  await assert.rejects(
    () => run("program", "get", {}, createMockFetch(), createLogCapture()),
    /An id is required/,
  );
});

test("program update posts the patch to /programs/{id}", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { id: "prog_1", object: "program", name: "Creators", status: "paused", visibility: "private" } },
  ]);
  const log = createLogCapture();
  await run("program", "update", { _: ["prog_1"], status: "paused" }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/programs/prog_1");
  assert.deepEqual(fetchImpl.calls[0].body, { status: "paused" });
  assert.match(log.text(), /Status: paused/);
});

test("missing programs:create surfaces the token-create suggestion", async () => {
  const fetchImpl = createMockFetch([
    { status: 403, body: { error: { code: "missing_scope", message: "missing_scope:programs:create" } } },
  ]);
  await assert.rejects(
    () => run("program", "create", { name: "P" }, fetchImpl, createLogCapture()),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "missing_scope");
      assert.equal(error.requiredScope, "programs:create");
      assert.match(error.suggestedCommand, /token create .*--scopes org:read,programs:create/);
      return true;
    },
  );
});

test("typed v1 error codes pass through (program_not_found)", async () => {
  await assert.rejects(
    () => run("program", "get", { _: ["prog_nope"] }, createMockFetch([
      { status: 404, body: { error: { code: "program_not_found", message: "Program not found for this brand." } } },
    ]), createLogCapture()),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "program_not_found");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("unknown program subcommand throws with the verb list", async () => {
  await assert.rejects(
    () => run("program", "destroy", {}, createMockFetch(), createLogCapture()),
    /Unknown program subcommand: destroy. Use create\|list\|get\|update/,
  );
});
