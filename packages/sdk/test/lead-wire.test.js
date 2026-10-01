import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { stableJson } from "@boomin/server";
import { createPostgresLeadStore, leadTrackingMigration } from "../src/leads/postgres.js";
import { createLeadTracker } from "../src/leads.js";

test("real signed transport retries lost acknowledgments against a deduplicating metric ledger", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("CREATE TABLE users (id text PRIMARY KEY);");
  await db.exec(leadTrackingMigration({ customerTable: "users" }));
  await db.exec("INSERT INTO users VALUES ('verified');");
  const store = createPostgresLeadStore({ query: (text, params) => db.query(text, params) });
  const tracker = createLeadTracker({ store, issuer: "brand.test", apiBase: "https://fixture.test/v1/connect",
    programs: [{ key: "lead", publicKey: "pk_lead", signingSecret: "fixture-secret" }] });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const ledger = new Map();
  const wireIds = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const standing = String(url).endsWith("/standing");
    const payload = standing ? body.payload : body;
    const signature = standing ? body.signature : init.headers["X-Boomin-Signature"];
    assert.equal(signature, createHmac("sha256", "fixture-secret").update(stableJson(payload)).digest("base64url"));
    if (standing) {
      assert.equal(payload.iss, "brand.test");
      assert.equal(payload.publicKey, "pk_lead");
      return Response.json({ entities: [{ referralCode: "creator" }] });
    }
    assert.equal(init.headers["X-Boomin-Issuer"], "brand.test");
    assert.equal(body.entity_ref, "creator");
    assert.equal(body.metric_key, "signups");
    wireIds.push(body.event_id);
    ledger.set(body.event_id, body);
    // The server accepted the first request, but its acknowledgment was lost.
    return wireIds.length === 1 ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json({ duplicate: true });
  };
  await tracker.recordSignup({ customerId: "verified", referralCode: "creator" });
  assert.equal((await tracker.deliver()).pending, 1);
  assert.equal((await store.getCustomer("verified")).referralCode, "creator");
  await db.exec("UPDATE boomin_sdk_lead_events SET next_attempt_at = now();");
  assert.equal((await tracker.deliver()).delivered, 1);
  assert.equal(wireIds.length, 2);
  assert.equal(wireIds[0], wireIds[1]);
  assert.equal(ledger.size, 1);
});
