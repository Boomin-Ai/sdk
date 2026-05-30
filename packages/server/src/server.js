const DEFAULT_CONNECT_API_BASE = "https://api.boomin.ai/v1/connect";
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
