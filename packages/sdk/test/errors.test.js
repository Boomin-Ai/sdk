import test from "node:test";
import assert from "node:assert/strict";

import {
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
  errorFromResponse,
} from "../src/errors.js";
import { createClient } from "./helpers.js";

const apiError = (status, code, message = "msg") =>
  errorFromResponse(status, { error: { code, message } }, "req_1");

test("status mapping when no typed code decides", () => {
  assert.ok(errorFromResponse(400, {}, null) instanceof InvalidRequestError);
  assert.ok(errorFromResponse(401, {}, null) instanceof AuthenticationError);
  assert.ok(errorFromResponse(402, {}, null) instanceof InvalidRequestError);
  assert.ok(errorFromResponse(403, {}, null) instanceof PermissionError);
  assert.ok(errorFromResponse(404, {}, null) instanceof InvalidRequestError);
  assert.ok(errorFromResponse(409, {}, null) instanceof ConflictError);
  assert.ok(errorFromResponse(422, {}, null) instanceof InvalidRequestError);
  assert.ok(errorFromResponse(429, {}, null) instanceof RateLimitError);
  assert.ok(errorFromResponse(500, {}, null) instanceof APIError);
  assert.ok(errorFromResponse(503, {}, null) instanceof APIError);
});

test("typed codes are surfaced distinctly and win over status", () => {
  const conflict = apiError(409, "operation_conflict", "a live operation holds this subject");
  assert.ok(conflict instanceof OperationConflictError);
  assert.ok(conflict instanceof ConflictError);
  assert.ok(conflict instanceof BoominError);
  assert.equal(conflict.code, "operation_conflict");

  const band = apiError(400, "band_limit_reached");
  assert.ok(band instanceof BandLimitReachedError);
  assert.ok(band instanceof InvalidRequestError);

  const funding = apiError(402, "funding_required");
  assert.ok(funding instanceof FundingRequiredError);
  assert.ok(funding instanceof InvalidRequestError);

  // code wins even when the status would map elsewhere
  const mismatched = apiError(500, "operation_conflict");
  assert.ok(mismatched instanceof OperationConflictError);

  const cancelInProgress = apiError(409, "cancellation_in_progress");
  assert.ok(cancelInProgress instanceof OperationConflictError);
});

test("error carries message, code, status, requestId, param", () => {
  const err = errorFromResponse(
    400,
    { error: { code: "invalid_request", message: "objective is required", param: "objective" } },
    "req_9",
  );
  assert.equal(err.message, "objective is required");
  assert.equal(err.code, "invalid_request");
  assert.equal(err.status, 400);
  assert.equal(err.requestId, "req_9");
  assert.equal(err.param, "objective");
  assert.equal(err.name, "InvalidRequestError");
});

test("falls back to a generic message and null code on unparseable bodies", () => {
  const err = errorFromResponse(500, null, null);
  assert.match(err.message, /status 500/);
  assert.equal(err.code, null);
  assert.ok(err instanceof APIError);
});

test("request_id in the body is used when no header id exists", () => {
  const err = errorFromResponse(400, { error: { message: "x", request_id: "req_body" } }, null);
  assert.equal(err.requestId, "req_body");
});

test("end-to-end: API error responses raise the typed class", async () => {
  const { boomin } = createClient([
    { status: 409, body: { error: { code: "operation_conflict", message: "launch already running" } } },
  ]);
  const err = await boomin.distributions.launch("dist_1").catch((e) => e);
  assert.ok(err instanceof OperationConflictError);
  assert.equal(err.status, 409);
  assert.equal(err.code, "operation_conflict");
});

test("end-to-end: funding_required surfaces from a launch", async () => {
  const { boomin } = createClient([
    { status: 402, body: { error: { code: "funding_required", message: "fund the wallet" } } },
  ]);
  const err = await boomin.distributions.launch("dist_1").catch((e) => e);
  assert.ok(err instanceof FundingRequiredError);
});
