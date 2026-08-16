/** @boomin/server — wire-shape tests for the Phase 7 additions (assertions,
 *  conversions, handoff operatingType, getStanding canonical name). All
 *  network is a recorded mock fetch; no requests leave the process. */

import { test, beforeEach, afterEach } from "node:test";
import nodeAssert from "node:assert";
import {
  assert as assertClaim,
  revokeAssertion,
  recordConversion,
  createHandoffPayload,
  getStanding,
  getPartnerStanding,
} from "../src/server.js";

const realFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const last = () => calls[calls.length - 1];

test("createHandoffPayload carries operatingType only when given", () => {
  const base = {
    publicKey: "pk_1", redirectUri: "https://t.example/done", issuer: "t.example",
    externalUserId: "u_1", email: "u@example.com", name: "U",
  };
  nodeAssert.equal("operatingType" in createHandoffPayload(base), false);
  nodeAssert.equal(createHandoffPayload({ ...base, operatingType: "advisor" }).operatingType, "advisor");
});

test("assert posts the claim to /v1/platform/assertions with Bearer + snake body", async () => {
  await assertClaim({
    secretKey: "sk_test_1", brand: "brand_1", idempotencyKey: "idem_1",
    externalUserId: "atlantium_profile_9", issuer: "atlantium.ai",
    key: "advisor_verified", value: true, expiresAt: "2030-01-01T00:00:00.000Z",
  });
  const call = last();
  nodeAssert.equal(call.url, "https://api.boomin.ai/v1/platform/assertions");
  nodeAssert.equal(call.method, "POST");
  nodeAssert.equal(call.headers.Authorization, "Bearer sk_test_1");
  nodeAssert.equal(call.headers["Boomin-Brand"], "brand_1");
  nodeAssert.equal(call.headers["Idempotency-Key"], "idem_1");
  nodeAssert.deepEqual(call.body, {
    external_user_id: "atlantium_profile_9", issuer: "atlantium.ai",
    key: "advisor_verified", value: true, expires_at: "2030-01-01T00:00:00.000Z",
  });
});

test("assert requires a platform secretKey — never a signing secret", async () => {
  await nodeAssert.rejects(
    () => assertClaim({ key: "advisor_verified", value: 1 }),
    /secretKey/,
  );
  nodeAssert.equal(calls.length, 0);
});

test("revokeAssertion is claim-addressed — subject + key, no event id", async () => {
  await revokeAssertion({ secretKey: "sk_test_1", entity: "ent_1", key: "advisor_verified" });
  const call = last();
  nodeAssert.equal(call.url, "https://api.boomin.ai/v1/platform/assertions/revoke");
  nodeAssert.deepEqual(call.body, { entity: "ent_1", key: "advisor_verified" });
});

test("recordConversion rides the signed events surface, idempotent on eventId", async () => {
  await recordConversion({
    publicKey: "pk_1", issuer: "t.example", signingSecret: "whsec_1",
    referralCode: "ref_abc", eventId: "atlantium_purchase_in_1",
    amountCents: 2900, currency: "usd", metadata: { plan: "club" },
  });
  const call = last();
  nodeAssert.equal(call.url, "https://api.boomin.ai/v1/connect/events");
  nodeAssert.equal(call.headers["X-Boomin-Issuer"], "t.example");
  nodeAssert.equal(typeof call.headers["X-Boomin-Signature"], "string");
  nodeAssert.equal(call.body.partner_ref, "ref_abc");
  nodeAssert.equal(call.body.metric_key, "gmv_cents");
  nodeAssert.equal(call.body.amount, 2900);
  nodeAssert.equal(call.body.event_id, "atlantium_purchase_in_1");
  nodeAssert.equal(call.body.event_type, "purchase");
});

test("recordConversion refuses to guess an amount", async () => {
  await nodeAssert.rejects(
    () => recordConversion({ publicKey: "pk_1", issuer: "t", signingSecret: "s", referralCode: "r" }),
    /amountCents/,
  );
});

test("getStanding is the canonical name; getPartnerStanding stays honored", async () => {
  const options = { publicKey: "pk_1", issuer: "t.example", signingSecret: "whsec_1", externalUserId: "u_1" };
  await getStanding(options);
  nodeAssert.equal(last().url, "https://api.boomin.ai/v1/connect/standing");
  await getPartnerStanding(options);
  nodeAssert.equal(last().url, "https://api.boomin.ai/v1/connect/standing");
  nodeAssert.equal(calls.length, 2);
});
