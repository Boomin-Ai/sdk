import test from "node:test";
import assert from "node:assert/strict";
import { createAttribution } from "../src/attribution.js";
import { createLeadSignupHandler, createReferralRedirectHandler } from "../src/leads/next.js";
import { leadTrackingFiles } from "../src/leads/scaffold.js";
import path from "node:path";

function browser(href, blocked = false) {
  const data = new Map();
  const win = { location: { href }, history: { state: { retained: true }, replaceState(state, _, url) {
    assert.deepEqual(state, { retained: true }); win.location.href = new URL(url, win.location.href).href;
  } }, localStorage: {
    getItem: (key) => { if (blocked) throw Error("blocked"); return data.get(key); },
    setItem: (key, value) => { if (blocked) throw Error("blocked"); data.set(key, value); },
    removeItem: (key) => data.delete(key),
  } };
  return win;
}
test("first touch survives later clicks, preserves UTM/hash, and expires without extending its window", () => {
  let now = 1000;
  const win = browser("https://brand.test/?ref=alice&utm_source=instagram#signup");
  const attr = createAttribution({ window: win, now: () => now });
  const first = attr.capture();
  assert.equal(win.location.href, "https://brand.test/?utm_source=instagram#signup");
  now += 1000;
  win.location.href = "https://brand.test/?ref=bob";
  assert.deepEqual(attr.capture(), first);
  assert.equal(createAttribution({ window: win, now: () => now }).get().referralCode, "alice");
  now = first.expiresAt;
  assert.equal(attr.get(), null);
  win.location.href = "https://brand.test/?ref=bob";
  assert.equal(attr.capture().referralCode, "bob");
});
test("SSR and denied storage are safe; denied persistence keeps referral in URL", () => {
  assert.equal(createAttribution().capture(), null);
  const win = browser("https://brand.test/?ref=alice", true);
  const attr = createAttribution({ window: win });
  assert.equal(attr.capture().referralCode, "alice");
  assert.equal(attr.get().referralCode, "alice");
  assert.ok(win.location.href.includes("ref=alice"));
  attr.clear();
  assert.equal(attr.get(), null);
});
test("signup requires origin and verified session, ignoring forged customer IDs and program selection", async () => {
  const records = [];
  let customer = { customerId: "session-customer" };
  const handler = createLeadSignupHandler({ tracker: { recordSignup: async (x) => records.push(x) },
    getCurrentCustomer: async () => customer, allowedOrigins: ["https://brand.test"] });
  const request = (origin, body = {}) => new Request("https://brand.test/api/signup", {
    method: "POST", headers: origin ? { origin, "Content-Type": "application/json" } : {}, body: JSON.stringify(body),
  });
  assert.equal((await handler(request("https://evil.test"))).status, 403);
  assert.equal((await handler(request(null))).status, 403);
  customer = null;
  assert.equal((await handler(request("https://brand.test"))).status, 401);
  customer = { customerId: "session-customer" };
  assert.equal((await handler(request("https://brand.test", { referralCode: "bad/code" }))).status, 400);
  assert.equal((await handler(request("https://brand.test", { referralCode: "alice", customerId: "victim", programKey: "forged" }))).status, 200);
  assert.deepEqual(records, [{ customerId: "session-customer", referralCode: "alice" }]);
});
test("redirect preserves campaign attribution and navigation during storage/logging failures", async () => {
  const handler = createReferralRedirectHandler({ destinationUrl: "https://brand.test/join#signup",
    tracker: { recordClick: async () => { throw Error("db unavailable"); } }, onError: () => { throw Error("logger unavailable"); } });
  const response = await handler(new Request("https://brand.test/r/alice?utm_source=instagram"), { params: Promise.resolve({ code: "alice" }) });
  const url = new URL(response.headers.get("location"));
  assert.equal(response.status, 302);
  assert.equal(url.searchParams.get("ref"), "alice");
  assert.equal(url.searchParams.get("utm_source"), "instagram");
  assert.equal(url.hash, "#signup");
});
test("shared scaffold generates durable signup, protected retry route and correct custom redirect imports", () => {
  const custom = "src/app/go/[code]/route.js";
  const files = leadTrackingFiles({ customerTable: "auth.users", redirectRoute: custom });
  assert.ok(files["boomin/lead-tracking.sql"].includes('AFTER INSERT ON "auth"."users"'));
  assert.ok(files["app/api/boomin/leads/deliver/route.js"].includes("!token"));
  const imports = files[custom].match(/from "([.][^\"]+)"/);
  assert.equal(path.normalize(path.join(path.dirname(custom), imports[1])), "lib/boomin-leads");
  assert.throws(() => leadTrackingFiles({ redirectRoute: "../route.js" }), /relative/);
});
