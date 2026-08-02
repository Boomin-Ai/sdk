import test from "node:test";
import assert from "node:assert/strict";

import { Boomin } from "../src/index.js";
import { constructEvent } from "../src/webhooks.js";
import { WebhookSignatureVerificationError } from "../src/errors.js";

const SECRET = "whsec_test_secret_1";
const ROTATED_SECRET = "whsec_test_secret_2";

const encoder = new TextEncoder();

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const EVENT = { id: "evt_1", type: "distribution.live", data: { object: { id: "dist_1" } } };
const PAYLOAD = JSON.stringify(EVENT);

async function makeHeader({ secret = SECRET, timestamp = Math.floor(Date.now() / 1000), payload = PAYLOAD, extraSecrets = [] } = {}) {
  const parts = [`t=${timestamp}`, `v1=${await sign(secret, `${timestamp}.${payload}`)}`];
  for (const extra of extraSecrets) {
    parts.push(`v1=${await sign(extra, `${timestamp}.${payload}`)}`);
  }
  return parts.join(",");
}

test("verifies a valid signature and returns the parsed event", async () => {
  const header = await makeHeader();
  const event = await constructEvent(PAYLOAD, header, SECRET);
  assert.deepEqual(event, EVENT);
});

test("is exposed statically as Boomin.webhooks.constructEvent", async () => {
  const header = await makeHeader();
  const event = await Boomin.webhooks.constructEvent(PAYLOAD, header, SECRET);
  assert.equal(event.type, "distribution.live");
});

test("accepts Uint8Array and ArrayBuffer payloads", async () => {
  const header = await makeHeader();
  const bytes = encoder.encode(PAYLOAD);
  assert.deepEqual(await constructEvent(bytes, header, SECRET), EVENT);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.deepEqual(await constructEvent(buffer, header, SECRET), EVENT);
});

test("rejects a bad signature", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const header = `t=${timestamp},v1=${"0".repeat(64)}`;
  await assert.rejects(
    constructEvent(PAYLOAD, header, SECRET),
    (err) =>
      err instanceof WebhookSignatureVerificationError &&
      err.code === "webhook_signature_invalid" &&
      /No v1 signature/.test(err.message),
  );
});

test("rejects a signature computed with the wrong secret", async () => {
  const header = await makeHeader({ secret: "whsec_wrong" });
  await assert.rejects(constructEvent(PAYLOAD, header, SECRET), WebhookSignatureVerificationError);
});

test("rejects a tampered payload", async () => {
  const header = await makeHeader();
  const tampered = PAYLOAD.replace("dist_1", "dist_2");
  await assert.rejects(constructEvent(tampered, header, SECRET), WebhookSignatureVerificationError);
});

test("rejects an expired timestamp (outside tolerance)", async () => {
  const old = Math.floor(Date.now() / 1000) - 301;
  const header = await makeHeader({ timestamp: old });
  await assert.rejects(
    constructEvent(PAYLOAD, header, SECRET, { tolerance: 300 }),
    (err) => err instanceof WebhookSignatureVerificationError && /tolerance/.test(err.message),
  );
});

test("accepts a timestamp inside the tolerance window", async () => {
  const recent = Math.floor(Date.now() / 1000) - 100;
  const header = await makeHeader({ timestamp: recent });
  assert.deepEqual(await constructEvent(PAYLOAD, header, SECRET, { tolerance: 300 }), EVENT);
});

test("tolerance: 0 disables the timestamp check", async () => {
  const ancient = 1000000000;
  const header = await makeHeader({ timestamp: ancient });
  assert.deepEqual(await constructEvent(PAYLOAD, header, SECRET, { tolerance: 0 }), EVENT);
});

test("rotation overlap: verifies when the header carries old + new v1 signatures", async () => {
  // Platform signs with both secrets during rotation; receiver only has the new one.
  const header = await makeHeader({ secret: SECRET, extraSecrets: [ROTATED_SECRET] });
  assert.deepEqual(await constructEvent(PAYLOAD, header, ROTATED_SECRET), EVENT);
  // ...and the old one still works too.
  assert.deepEqual(await constructEvent(PAYLOAD, header, SECRET), EVENT);
});

test("rotation overlap: accepts an array of candidate secrets", async () => {
  const header = await makeHeader({ secret: ROTATED_SECRET });
  assert.deepEqual(await constructEvent(PAYLOAD, header, [SECRET, ROTATED_SECRET]), EVENT);
});

test("rejects when no candidate secret matches", async () => {
  const header = await makeHeader({ secret: "whsec_other" });
  await assert.rejects(
    constructEvent(PAYLOAD, header, [SECRET, ROTATED_SECRET]),
    WebhookSignatureVerificationError,
  );
});

test("rejects malformed headers", async () => {
  for (const header of ["", "t=abc", "v1=deadbeef", "nonsense", undefined]) {
    await assert.rejects(
      constructEvent(PAYLOAD, header, SECRET),
      WebhookSignatureVerificationError,
      `header: ${String(header)}`,
    );
  }
});

test("rejects a non-numeric timestamp", async () => {
  const header = `t=notanumber,v1=${await sign(SECRET, `notanumber.${PAYLOAD}`)}`;
  await assert.rejects(
    constructEvent(PAYLOAD, header, SECRET),
    (err) => /not a number/.test(err.message),
  );
});

test("rejects when the secret is missing", async () => {
  const header = await makeHeader();
  await assert.rejects(constructEvent(PAYLOAD, header, ""), WebhookSignatureVerificationError);
  await assert.rejects(constructEvent(PAYLOAD, header, []), WebhookSignatureVerificationError);
});

test("rejects a pre-parsed (object) payload with a helpful message", async () => {
  const header = await makeHeader();
  await assert.rejects(
    constructEvent(EVENT, header, SECRET),
    (err) => /raw request body/.test(err.message),
  );
});
