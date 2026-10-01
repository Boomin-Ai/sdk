import { getStanding, postProgramEvent } from "@boomin/server";
import { normalizeReferralCode } from "./attribution.js";

/** Durable lead reporting; storage belongs to the brand's application. */
export function createLeadTracker(options) {
  const { store, issuer, programs } = options || {};
  if (!store || !issuer || !Array.isArray(programs) || !programs.length) throw new Error("Lead tracker requires store, issuer, and programs.");
  const keys = new Set();
  for (const program of programs) {
    if (!program.key || !program.publicKey || !program.signingSecret || keys.has(program.key)) {
      throw new Error("Every lead program needs a unique key, publicKey, and signingSecret.");
    }
    keys.add(program.key);
  }
  const transport = options.transport || { getStanding, postProgramEvent };

  async function recordSignup({ customerId, referralCode, metadata = {} }) {
    requireId(customerId, "customerId");
    // An authenticated, server-derived customer ID is mandatory. The store
    // consumes its creation boundary atomically, including organic signups.
    return store.captureSignup({ customerId, referralCode: normalizeReferralCode(referralCode), metadata,
      eventId: `signup:${issuer}:${customerId}` });
  }

  async function recordClick({ referralCode, eventId = `click:${crypto.randomUUID()}`, metadata = {} }) {
    const code = normalizeReferralCode(referralCode);
    if (!code) return { accepted: false, reason: "invalid_referral" };
    requireId(eventId, "eventId");
    await store.enqueue({ id: eventId, referralCode: code, metricKey: "link_clicks", eventType: "referral_click", metadata });
    return { accepted: true, eventId };
  }

  async function recordQualifiedLead({ customerId, eventId, programKey, metricKey = "x:qualified_leads", metadata = {} }) {
    requireId(customerId, "customerId");
    requireId(eventId, "eventId");
    if (!keys.has(programKey)) throw new Error("Unknown qualified-lead programKey.");
    if (!/^x:[a-zA-Z0-9_]+$/.test(metricKey)) throw new Error("Use a configured x: metric for qualified leads.");
    const customer = await store.getCustomer(customerId);
    const code = customer?.referralCode || customer?.candidateReferralCode;
    if (!code) return { accepted: false, reason: "no_attribution" };
    if (customer.programKey && customer.programKey !== programKey) return { accepted: false, reason: "wrong_program" };
    await store.enqueue({ id: eventId, customerId, referralCode: code, programKey,
      metricKey, eventType: "qualified_lead", metadata });
    return { accepted: true, eventId };
  }

  async function deliver({ limit = 25 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Delivery limit must be 1–100.");
    const events = (await store.claim(limit)).sort((a, b) => Number(b.metricKey === "signups") - Number(a.metricKey === "signups"));
    const rosters = new Map();
    const result = { attempted: events.length, delivered: 0, invalid: 0, pending: 0 };
    for (const event of events) {
      try {
        const candidates = event.programKey ? programs.filter((p) => p.key === event.programKey) : programs;
        if (!candidates.length) throw new Error("Event program is not configured.");
        const matches = [];
        for (const program of candidates) {
          if (!rosters.has(program.key)) {
            const standing = await transport.getStanding({ issuer, apiBase: options.apiBase,
              publicKey: program.publicKey, programId: program.programId, signingSecret: program.signingSecret });
            if (!Array.isArray(standing.entities)) throw new Error("Unexpected standing response; entities is required.");
            rosters.set(program.key, standing.entities);
          }
          if (rosters.get(program.key).some((row) => row.referralCode === event.referralCode || row.referral?.code === event.referralCode)) {
            matches.push(program);
          }
        }
        if (matches.length !== 1) {
          await store.invalidate(event, matches.length ? "Ambiguous referral code" : "Unknown referral code");
          result.invalid++;
          continue;
        }
        const program = matches[0];
        if (event.metricKey === "signups") {
          await store.saveAttribution(event.customerId, event.referralCode, program.key);
        } else if (event.customerId) {
          const customer = await store.getCustomer(event.customerId);
          if (!customer?.referralCode) throw new Error("Signup attribution is pending.");
          if (customer.referralCode !== event.referralCode || customer.programKey !== program.key) {
            await store.invalidate(event, "Qualified lead differs from saved attribution");
            result.invalid++;
            continue;
          }
        }
        const customer = event.customerId ? await store.getCustomer(event.customerId) : null;
        if (event.customerId && (customer?.referralCode !== event.referralCode || customer?.programKey !== program.key)) {
          throw new Error("Event differs from saved customer attribution.");
        }
        await transport.postProgramEvent({ issuer, apiBase: options.apiBase, signingSecret: program.signingSecret,
          body: { publicKey: program.publicKey, ...(program.programId ? { programId: program.programId } : {}),
            entity_ref: event.referralCode, event_id: event.id, event_type: event.eventType,
            metric_key: event.metricKey, amount: 1, occurred_at: new Date(event.occurredAt).toISOString(), metadata: event.metadata } });
        if (!await store.complete(event, program.key)) throw new Error("Delivery lease changed before acknowledgment.");
        result.delivered++;
      } catch (error) {
        // Persist a concise message, never tokens or response bodies.
        await store.retry(event, Number.isInteger(error?.status)
          ? `Lead delivery failed (HTTP ${error.status}); retry scheduled.`
          : "Lead delivery failed; retry scheduled.");
        result.pending++;
      }
    }
    return result;
  }

  return { recordSignup, recordClick, recordQualifiedLead, deliver };
}

function requireId(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error(`${name} must be a stable, nonempty string (max 512 characters).`);
}
