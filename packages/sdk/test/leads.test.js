import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresLeadStore, leadTrackingMigration } from "../src/leads/postgres.js";
import { createLeadTracker } from "../src/leads.js";

const programs = [
  { key: "tech", publicKey: "pk_tech", signingSecret: "test-tech" },
  { key: "head", publicKey: "pk_head", signingSecret: "test-head" },
];
async function fixture(t, options = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("CREATE TABLE users (id text PRIMARY KEY); INSERT INTO users VALUES ('existing');");
  await db.exec(leadTrackingMigration({ customerTable: "users" }));
  const store = createPostgresLeadStore({ query: (sql, params) => db.query(sql, params) });
  const posts = [];
  const transport = {
    getStanding: async ({ publicKey }) => ({ entities: [{ referralCode: publicKey === "pk_tech" ? "alice" : "bob" }] }),
    postProgramEvent: async (event) => { posts.push(event); },
    ...options.transport,
  };
  const tracker = createLeadTracker({ store, issuer: "example.test", programs, transport });
  return { db, store, tracker, posts };
}

test("new-account trigger closes organic capture; existing accounts cannot acquire attribution", async (t) => {
  const { db, tracker, store } = await fixture(t);
  assert.equal((await tracker.recordSignup({ customerId: "existing", referralCode: "alice" })).accepted, false);
  await db.exec("INSERT INTO users VALUES ('organic');");
  assert.equal((await tracker.recordSignup({ customerId: "organic" })).reason, "organic");
  assert.equal((await tracker.recordSignup({ customerId: "organic", referralCode: "alice" })).accepted, false);
  assert.equal((await store.deliveryStatus()).events.length, 0);
});

test("concurrent signup retries preserve first attribution and enqueue exactly one event", async (t) => {
  const { db, tracker, store, posts } = await fixture(t);
  await db.exec("INSERT INTO users VALUES ('new');");
  const captures = await Promise.all(["alice", "bob", "bob"].map((referralCode) => tracker.recordSignup({ customerId: "new", referralCode })));
  assert.equal(captures.filter((x) => x.accepted).length, 1);
  assert.equal((await store.getCustomer("new")).candidateReferralCode, "alice");
  assert.equal((await tracker.deliver()).delivered, 1);
  assert.equal(posts[0].body.entity_ref, "alice");
  assert.equal(posts[0].body.event_id, "signup:example.test:new");
  assert.equal(posts[0].body.publicKey, "pk_tech");
  assert.equal((await store.getCustomer("new")).programKey, "tech");
  assert.equal((await tracker.deliver()).attempted, 0);
});

test("expired signup window is closed and cannot be reopened", async (t) => {
  const { tracker, store } = await fixture(t);
  await store.openSignup({ customerId: "old", createdAt: "2020-01-01T00:00:00Z" });
  await store.openSignup({ customerId: "old", createdAt: new Date() });
  assert.equal((await tracker.recordSignup({ customerId: "old", referralCode: "alice" })).accepted, false);
});

test("unknown and ambiguous referrals never credit a program", async (t) => {
  const { tracker, posts, store } = await fixture(t, { transport: {
    getStanding: async () => ({ entities: [{ referral: { code: "shared" } }] }),
  } });
  await tracker.recordClick({ referralCode: "unknown", eventId: "unknown" });
  await tracker.recordClick({ referralCode: "shared", eventId: "ambiguous" });
  assert.equal((await tracker.deliver()).invalid, 2);
  assert.equal(posts.length, 0);
  assert.deepEqual((await store.deliveryStatus()).summary, [{ status: "invalid", count: 2 }]);
});

test("outage persists customer attribution and retries the same event ID", async (t) => {
  let outage = true;
  const attempts = [];
  const { db, tracker, store } = await fixture(t, { transport: {
    postProgramEvent: async ({ body }) => { attempts.push(body.event_id); if (outage) throw new Error("unavailable"); },
  } });
  await db.exec("INSERT INTO users VALUES ('retry');");
  await tracker.recordSignup({ customerId: "retry", referralCode: "bob" });
  assert.equal((await tracker.deliver()).pending, 1);
  assert.equal((await store.getCustomer("retry")).programKey, "head");
  assert.equal((await tracker.deliver()).attempted, 0);
  outage = false;
  await db.exec("UPDATE boomin_sdk_lead_events SET next_attempt_at = now();");
  assert.equal((await tracker.deliver()).delivered, 1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
});

test("roster outage stays pending rather than marking an unknown referral", async (t) => {
  const { tracker, store } = await fixture(t, { transport: { getStanding: async () => { throw new Error("offline"); } } });
  await tracker.recordClick({ referralCode: "alice", eventId: "offline" });
  assert.equal((await tracker.deliver()).pending, 1);
  assert.equal((await store.deliveryStatus()).events[0].status, "pending");
});

test("qualification queued before signup delivery uses saved program and stable business-event ID", async (t) => {
  const { db, tracker, posts } = await fixture(t);
  await db.exec("INSERT INTO users VALUES ('qualified');");
  await tracker.recordSignup({ customerId: "qualified", referralCode: "bob" });
  const input = { customerId: "qualified", programKey: "head", eventId: "profile:qualified:v1" };
  assert.equal((await tracker.recordQualifiedLead(input)).accepted, true);
  await tracker.recordQualifiedLead(input);
  assert.equal((await tracker.deliver()).delivered, 2);
  assert.deepEqual(posts.map((x) => x.body.metric_key).sort(), ["signups", "x:qualified_leads"]);
  assert.equal((await tracker.recordQualifiedLead({ ...input, programKey: "tech", eventId: "wrong" })).reason, "wrong_program");
});

test("leases prevent concurrent delivery and stale acknowledgments; abandoned claims recover", async (t) => {
  const { db, tracker, store } = await fixture(t);
  await tracker.recordClick({ referralCode: "alice", eventId: "leased" });
  const [first] = await store.claim(25);
  assert.equal((await store.claim(25)).length, 0);
  await db.exec("UPDATE boomin_sdk_lead_events SET lease_until = now() - interval '1 minute';");
  const [second] = await store.claim(25);
  assert.notEqual(first.leaseToken, second.leaseToken);
  assert.equal(await store.complete(first, "tech"), false);
  assert.equal(await store.complete(second, "tech"), true);
});

test("separate brand stores isolate signup identity and event IDs", async (t) => {
  const { db, store } = await fixture(t);
  await db.exec(leadTrackingMigration({ tablePrefix: "brand_two" }));
  const other = createPostgresLeadStore({ query: (sql, params) => db.query(sql, params), tablePrefix: "brand_two" });
  await other.openSignup({ customerId: "same", createdAt: new Date() });
  assert.equal(await store.getCustomer("same"), null);
  assert.ok(await other.getCustomer("same"));
  assert.throws(() => leadTrackingMigration({ customerTable: "users; DROP TABLE users" }), /identifier/);
  assert.throws(() => leadTrackingMigration({ customerTable: "users", customerIdColumn: "id');DROP" }), /column/);
  assert.throws(() => createPostgresLeadStore({ tablePrefix: "bad;drop" }), /identifier/);
  assert.throws(() => leadTrackingMigration({ storageSchema: "public;drop" }), /identifier/);
});

test("auth insertion can open signup through a restricted role with a different search path", async (t) => {
  const { db, store } = await fixture(t);
  await db.exec("CREATE ROLE auth_signup; GRANT USAGE ON SCHEMA public TO auth_signup; GRANT INSERT ON public.users TO auth_signup;");
  await db.exec("SET ROLE auth_signup; SET search_path = pg_catalog; INSERT INTO public.users VALUES ('restricted'); RESET ROLE; SET search_path = public;");
  assert.ok(await store.getCustomer("restricted"));
});

test("explicit storage schema isolates tables from the connection search path", async (t) => {
  const { db } = await fixture(t);
  await db.exec("CREATE SCHEMA leads;");
  await db.exec(leadTrackingMigration({ storageSchema: "leads" }));
  const store = createPostgresLeadStore({ query: (sql, params) => db.query(sql, params), storageSchema: "leads" });
  await db.exec("SET search_path = pg_catalog;");
  await store.openSignup({ customerId: "schema-isolated", createdAt: new Date() });
  assert.ok(await store.getCustomer("schema-isolated"));
});

test("saved attribution cannot be moved to another program or referrer", async (t) => {
  const { db, tracker, store } = await fixture(t);
  await db.exec("INSERT INTO users VALUES ('immutable');");
  await tracker.recordSignup({ customerId: "immutable", referralCode: "alice" });
  await tracker.deliver();
  await store.saveAttribution("immutable", "bob", "head");
  await store.saveAttribution("immutable", "alice", "head");
  assert.equal((await store.getCustomer("immutable")).referralCode, "alice");
  assert.equal((await store.getCustomer("immutable")).programKey, "tech");
});
