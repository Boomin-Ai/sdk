import { normalizeReferralCode } from "../attribution.js";

/** Web-standard handler; works in Next route handlers and other Fetch routers. */
export function createLeadSignupHandler({ tracker, getCurrentCustomer, allowedOrigins }) {
  if (!tracker || typeof getCurrentCustomer !== "function" || !allowedOrigins?.length) {
    throw new Error("Signup handler requires tracker, authenticated getCurrentCustomer, and allowedOrigins.");
  }
  return async function POST(request) {
    const origin = request.headers.get("origin");
    if (!origin || !allowedOrigins.includes(origin)) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    const customer = await getCurrentCustomer(request);
    if (!customer?.customerId) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.referralCode != null && !normalizeReferralCode(body.referralCode))) {
      return Response.json({ error: "invalid_referral" }, { status: 400 });
    }
    // Never accept customerId, programKey, or signup eligibility from JSON.
    await tracker.recordSignup({ customerId: customer.customerId, referralCode: body.referralCode });
    return Response.json({ accepted: true });
  };
}

export function createReferralRedirectHandler({ tracker, destinationUrl, onError = () => {} }) {
  if (!tracker || !destinationUrl) throw new Error("Redirect handler requires tracker and destinationUrl.");
  const destination = new URL(destinationUrl);
  if (!["http:", "https:"].includes(destination.protocol)) throw new Error("Referral destination must be an HTTP(S) URL.");
  return async function GET(request, { params }) {
    const code = normalizeReferralCode((await params).code);
    const url = new URL(destination);
    if (code) {
      url.searchParams.set("ref", code);
      const incoming = new URL(request.url);
      const metadata = {};
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
        const value = incoming.searchParams.get(key);
        if (value) { url.searchParams.set(key, value); metadata[key] = value; }
      }
      try { await tracker.recordClick({ referralCode: code, metadata }); }
      catch (error) { try { onError(error); } catch { /* Logging must not block navigation. */ } }
    }
    return Response.redirect(url.toString(), 302);
  };
}
