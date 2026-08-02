/**
 * Boomin webhook signature verification (WebCrypto HMAC-SHA256).
 *
 * Header format: `Boomin-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]`
 * The signed message is `${t}.${rawPayload}`. Multiple v1 entries appear during
 * secret rotation (the platform signs with old + new for the overlap window);
 * the receiving side may equally pass an array of candidate secrets.
 */

import { WebhookSignatureVerificationError } from "./errors.js";

export const DEFAULT_TOLERANCE_SECONDS = 300;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toPayloadString(payload) {
  if (typeof payload === "string") return payload;
  if (payload instanceof Uint8Array) return textDecoder.decode(payload);
  if (payload instanceof ArrayBuffer) return textDecoder.decode(new Uint8Array(payload));
  throw new WebhookSignatureVerificationError(
    "Webhook payload must be the raw request body as a string, Uint8Array, or ArrayBuffer. " +
      "Do not JSON.parse the body before verification.",
  );
}

function parseSignatureHeader(sigHeader) {
  if (typeof sigHeader !== "string" || sigHeader.trim() === "") {
    return { timestamp: null, signatures: [] };
  }
  let timestamp = null;
  const signatures = [];
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value !== "") signatures.push(value);
  }
  return { timestamp, signatures };
}

function hexFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string comparison (length inequality returns early — length is public). */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function computeHmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  return hexFromBuffer(signature);
}

/**
 * Verify a `Boomin-Signature` header and return the parsed event.
 *
 * Async because WebCrypto is async — `await` the result.
 *
 * @param {string | Uint8Array | ArrayBuffer} payload Raw request body.
 * @param {string} sigHeader The `Boomin-Signature` header value.
 * @param {string | string[]} secret Endpoint signing secret(s) — pass an array
 *   during secret rotation to accept either secret.
 * @param {{ tolerance?: number, now?: number }} [options] `tolerance` is the max
 *   allowed signature age in seconds (default 300); `now` overrides the clock
 *   (unix seconds) for testing.
 * @returns {Promise<object>} The JSON-parsed event.
 */
export async function constructEvent(payload, sigHeader, secret, options = {}) {
  const payloadString = toPayloadString(payload);
  const details = { sigHeader: typeof sigHeader === "string" ? sigHeader : null, payload: payloadString };

  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(
    (candidate) => typeof candidate === "string" && candidate !== "",
  );
  if (secrets.length === 0) {
    throw new WebhookSignatureVerificationError(
      "A webhook signing secret is required to verify the Boomin-Signature header.",
      details,
    );
  }

  const { timestamp, signatures } = parseSignatureHeader(sigHeader);
  if (timestamp === null || signatures.length === 0) {
    throw new WebhookSignatureVerificationError(
      "Unable to extract timestamp and v1 signatures from the Boomin-Signature header. " +
        "Expected format: t=<unix seconds>,v1=<hex hmac>.",
      details,
    );
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new WebhookSignatureVerificationError(
      "The Boomin-Signature timestamp is not a number.",
      details,
    );
  }

  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = options.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && timestampSeconds < nowSeconds - tolerance) {
    throw new WebhookSignatureVerificationError(
      `Webhook timestamp is outside the tolerance window (${tolerance}s). ` +
        "The event may be a replay, or the receiving clock is skewed.",
      details,
    );
  }

  const message = `${timestamp}.${payloadString}`;
  let matched = false;
  for (const candidate of secrets) {
    const expected = await computeHmacHex(candidate, message);
    for (const provided of signatures) {
      // Evaluate every pair (no early exit) to keep comparison time uniform.
      if (timingSafeEqual(expected, provided)) matched = true;
    }
  }
  if (!matched) {
    throw new WebhookSignatureVerificationError(
      "No v1 signature in the Boomin-Signature header matches the expected signature for this payload.",
      details,
    );
  }

  try {
    return JSON.parse(payloadString);
  } catch {
    throw new WebhookSignatureVerificationError(
      "Webhook signature verified but the payload is not valid JSON.",
      details,
    );
  }
}
