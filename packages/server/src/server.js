const DEFAULT_CONNECT_API_BASE = "https://api.boomin.ai/v1/connect";
const DEFAULT_PLATFORM_API_BASE = "https://api.boomin.ai/v1/platform";
const DEFAULT_AUDIENCE = "boomin.ai";

const textEncoder = new TextEncoder();

export function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

export async function signHandoffPayload(payload, signingSecret) {
  if (!signingSecret) throw new Error("signHandoffPayload requires a signingSecret.");
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(stableJson(payload)));
  return base64Url(new Uint8Array(signature));
}

export function createHandoffPayload(options) {
  if (!options?.publicKey) throw new Error("createHandoffPayload requires publicKey.");
  if (!options?.redirectUri) throw new Error("createHandoffPayload requires redirectUri.");
  if (!options?.issuer) throw new Error("createHandoffPayload requires issuer.");
  if (!options?.externalUserId) throw new Error("createHandoffPayload requires externalUserId.");
  if (!options?.email) throw new Error("createHandoffPayload requires email.");
  if (!options?.name) throw new Error("createHandoffPayload requires name.");

  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    iss: options.issuer,
    aud: options.audience || DEFAULT_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + (options.expiresInSeconds || 5 * 60),
    nonce: options.nonce || crypto.randomUUID(),
    publicKey: options.publicKey,
    programId: options.programId,
    redirectUri: options.redirectUri,
    externalUserId: options.externalUserId,
    email: options.email,
    name: options.name,
    // Operating capacity by KEY (e.g. "advisor") — a tenant claim, so it
    // rides the SIGNED payload. Boomin consumes it leniently: unknown or
    // archived keys are skipped, never a reason to fail a signup.
    ...(options.operatingType ? { operatingType: options.operatingType } : {}),
    metadata: options.metadata || {},
  };
}

export async function createSignedHandoff(options) {
  const payload = createHandoffPayload(options);
  const signature = await signHandoffPayload(payload, options.signingSecret);
  return { payload, signature, signingAlg: "HMAC-SHA256" };
}

export async function postHandoff(options) {
  const apiBase = stripTrailingSlash(options.apiBase || DEFAULT_CONNECT_API_BASE);
  const signed = options.payload && options.signature
    ? { payload: options.payload, signature: options.signature }
    : await createSignedHandoff(options);
  const response = await fetch(`${apiBase}/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || `Boomin handoff failed with ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.response = data;
    throw error;
  }
  return data;
}

export async function postProgramEvent(options) {
  if (!options?.issuer) throw new Error("postProgramEvent requires issuer.");
  if (!options?.signingSecret) throw new Error("postProgramEvent requires signingSecret.");
  const body = options.event || options.body;
  if (!body || typeof body !== "object") throw new Error("postProgramEvent requires an event object.");

  const apiBase = stripTrailingSlash(options.apiBase || DEFAULT_CONNECT_API_BASE);
  const signature = await signPayload(body, options.signingSecret);
  const response = await fetch(`${apiBase}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Boomin-Issuer": options.issuer,
      "X-Boomin-Signature": signature,
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || `Boomin event ingestion failed with ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.response = data;
    throw error;
  }
  return data;
}

export function createStandingPayload(options) {
  if (!options?.publicKey) throw new Error("createStandingPayload requires publicKey.");
  if (!options?.issuer) throw new Error("createStandingPayload requires issuer.");

  const issuedAt = Math.floor(Date.now() / 1000);
  return removeEmpty({
    iss: options.issuer,
    aud: options.audience || DEFAULT_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + (options.expiresInSeconds || 5 * 60),
    nonce: options.nonce || crypto.randomUUID(),
    publicKey: options.publicKey,
    programId: options.programId,
    externalUserId: options.externalUserId,
  });
}

export async function getPartnerStanding(options) {
  if (!options?.signingSecret) throw new Error("getPartnerStanding requires signingSecret.");
  const apiBase = stripTrailingSlash(options.apiBase || DEFAULT_CONNECT_API_BASE);
  const payload = options.payload || createStandingPayload(options);
  const signature = options.signature || await signHandoffPayload(payload, options.signingSecret);
  const response = await fetch(`${apiBase}/standing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, signature }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || `Boomin standing request failed with ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.response = data;
    throw error;
  }
  return data;
}

/** Canonical name (RELATIONSHIP_CORE): standing of one relationship. */
export function getStanding(options) {
  return getPartnerStanding(options);
}

// ── Assertions (RELATIONSHIP_CORE §4) — the platform-key surface ─────────────
// Assertions are TENANT TRUTH: your backend computes a private condition
// (verification, membership, employment) and asserts only the OUTCOME — Boomin
// never sees the underlying data. Claim-addressed by (subject, key); the
// subject is `externalUserId`+`issuer` (the pair your signed handoffs bind) or
// an `entity` id. Requires a PLATFORM secret key (`sk_…`, scope
// `assertions:write`) — never a Connect signing secret.

async function platformRequest(options, path, body) {
  if (!options?.secretKey) throw new Error("Assertion helpers require secretKey (a platform sk_ key with assertions:write).");
  const apiBase = stripTrailingSlash(options.platformApiBase || options.apiBase || DEFAULT_PLATFORM_API_BASE);
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.secretKey}`,
      ...(options.brand ? { "Boomin-Brand": options.brand } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || `Boomin assertion request failed with ${response.status}`);
    error.status = response.status;
    error.code = data.error?.code || data.code;
    error.response = data;
    throw error;
  }
  return data;
}

/** Assert (create/refresh) a claim. Re-asserting with a fresh `expiresAt`
 *  EXTENDS it — a refreshed expiry is a new event, same claim. */
export async function assert(options) {
  if (!options?.key) throw new Error("assert requires key.");
  if (options.value === undefined) throw new Error("assert requires value (number or boolean).");
  return platformRequest(options, "/assertions", removeEmpty({
    entity: options.entity,
    external_user_id: options.externalUserId,
    issuer: options.issuer,
    key: options.key,
    value: options.value,
    expires_at: options.expiresAt ? new Date(options.expiresAt).toISOString() : undefined,
  }));
}

/** Revoke by claim address — `{externalUserId, issuer, key}` (or `entity`).
 *  Never by `asrt_` event id: events are history, claims are state. */
export async function revokeAssertion(options) {
  if (!options?.key) throw new Error("revokeAssertion requires key.");
  return platformRequest(options, "/assertions/revoke", removeEmpty({
    entity: options.entity,
    external_user_id: options.externalUserId,
    issuer: options.issuer,
    key: options.key,
  }));
}

/**
 * Forward a CONVERSION (a paid event) onto the relationship the referral code
 * names — the gmv side of the loop. Rides the signed Connect events surface,
 * so it needs `issuer` + `signingSecret` + `publicKey`. Idempotent on
 * `eventId` (Boomin's source_event_id dedupe): pass a stable id derived from
 * your own billing record (`atlantium_purchase_${invoice.id}`), and a retry —
 * yours or a webhook redelivery — can never double-count.
 */
export async function recordConversion(options) {
  if (!options?.referralCode && !options?.partnerRef) throw new Error("recordConversion requires referralCode.");
  if (options.amountCents == null) throw new Error("recordConversion requires amountCents.");
  return postMetricEvent(
    {
      ...options,
      partnerRef: options.partnerRef || options.referralCode,
      eventType: options.eventType || "purchase",
      amount: options.amountCents,
    },
    "gmv_cents",
    options.amountCents,
  );
}

export function recordReferralClick(options) {
  return postMetricEvent(options, "link_clicks", 1);
}

export function recordSignup(options) {
  return postMetricEvent(options, "referral_count", 1);
}

export async function recordSale(options) {
  const sale = await postMetricEvent({ ...options, amount: options.saleCount ?? options.amount ?? 1 }, "sales_count", 1);
  if (options.gmvCents == null) return sale;

  const gmv = await postMetricEvent(
    {
      ...options,
      eventId: options.eventId ? `${options.eventId}:gmv` : undefined,
      eventType: options.gmvEventType || "gmv_cents",
      amount: options.gmvCents,
    },
    "gmv_cents",
    options.gmvCents,
  );
  return { ...sale, gmv };
}

export function recordProductUsage(options) {
  return postMetricEvent(options, "product_usage_count", options.amount || 1);
}

async function postMetricEvent(options, metricKey, defaultAmount) {
  if (!options?.publicKey) throw new Error("Program event helpers require publicKey.");
  if (!options?.partnerRef) throw new Error("Program event helpers require partnerRef.");
  const body = removeEmpty({
    event_id: options.eventId || crypto.randomUUID(),
    event_type: options.eventType || metricKey,
    publicKey: options.publicKey,
    programId: options.programId,
    partner_ref: options.partnerRef,
    metric_key: metricKey,
    amount: options.amount ?? defaultAmount,
    currency: options.currency,
    occurred_at: options.occurredAt ? new Date(options.occurredAt).toISOString() : undefined,
    metadata: options.metadata || {},
  });
  return postProgramEvent({
    apiBase: options.apiBase,
    issuer: options.issuer,
    signingSecret: options.signingSecret,
    body,
    headers: options.headers,
  });
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}

function removeEmpty(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(payload, signingSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(stableJson(payload)));
  return base64Url(new Uint8Array(signature));
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
