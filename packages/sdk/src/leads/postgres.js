/** PostgreSQL adapter: compatible with pg, Neon HTTP, and transaction clients.
 * Supply query(text, params). No database driver is bundled at runtime. */
export function leadTrackingMigration({ customerTable, customerIdColumn = "id", tablePrefix = "boomin_sdk", storageSchema = "public" } = {}) {
  validatePrefix(tablePrefix);
  const rewrite = (sql) => sql.replace(/\bboomin_sdk_(lead_customers|lead_events|lead_due|open_signup|signup_capture)\b/g, (_, suffix) =>
    ["lead_customers", "lead_events", "open_signup"].includes(suffix) ? `${schemaIdentifier(storageSchema)}.${tablePrefix}_${suffix}` : `${tablePrefix}_${suffix}`);
  schemaIdentifier(storageSchema);
  const trigger = customerTable ? `
CREATE OR REPLACE FUNCTION ${rewrite("boomin_sdk_open_signup")}() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO ${rewrite("boomin_sdk_lead_customers")} (customer_id, capture_until)
  VALUES (to_jsonb(NEW)->>TG_ARGV[0], now() + interval '30 minutes')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ${rewrite("boomin_sdk_signup_capture")} ON ${identifier(customerTable)};
CREATE TRIGGER ${rewrite("boomin_sdk_signup_capture")} AFTER INSERT ON ${identifier(customerTable)}
FOR EACH ROW EXECUTE FUNCTION ${rewrite("boomin_sdk_open_signup")}(${literalColumn(customerIdColumn)});
` : "";
  return rewrite(`CREATE TABLE IF NOT EXISTS boomin_sdk_lead_customers (
  customer_id text PRIMARY KEY,
  capture_until timestamptz NOT NULL,
  captured_at timestamptz,
  candidate_referral_code text,
  referral_code text,
  program_key text
);
CREATE TABLE IF NOT EXISTS boomin_sdk_lead_events (
  id text PRIMARY KEY,
  customer_id text REFERENCES boomin_sdk_lead_customers(customer_id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  program_key text,
  metric_key text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'invalid')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  last_error text,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS boomin_sdk_lead_due ON boomin_sdk_lead_events(next_attempt_at)
WHERE status = 'pending';
`) + trigger;
}

export function createPostgresLeadStore({ query, tablePrefix = "boomin_sdk", storageSchema = "public" } = {}) {
  validatePrefix(tablePrefix);
  const rewrite = (sql) => sql.replace(/\bboomin_sdk_(lead_customers|lead_events|lead_due|open_signup|signup_capture)\b/g, (_, suffix) =>
    ["lead_customers", "lead_events", "open_signup"].includes(suffix) ? `${schemaIdentifier(storageSchema)}.${tablePrefix}_${suffix}` : `${tablePrefix}_${suffix}`);
  schemaIdentifier(storageSchema);
  if (typeof query !== "function") throw new Error("Postgres lead store requires query(text, params).");
  async function rows(text, params = []) {
    const result = await query(rewrite(text), params);
    return Array.isArray(result) ? result : result.rows;
  }
  async function getCustomer(id) {
    const [row] = await rows("SELECT * FROM boomin_sdk_lead_customers WHERE customer_id = $1", [id]);
    return row ? { customerId: row.customer_id, candidateReferralCode: row.candidate_referral_code,
      referralCode: row.referral_code, programKey: row.program_key, capturedAt: row.captured_at } : null;
  }
  async function captureSignup({ customerId, referralCode, eventId, metadata }) {
    const captured = await rows(`WITH captured AS (
      UPDATE boomin_sdk_lead_customers SET captured_at = now(), candidate_referral_code = $2
      WHERE customer_id = $1 AND captured_at IS NULL AND capture_until > now()
      RETURNING customer_id
    ), queued AS (
      INSERT INTO boomin_sdk_lead_events (id, customer_id, referral_code, metric_key, event_type, metadata)
      SELECT $3, customer_id, $2, 'signups', 'referral_signup', $4::jsonb
      FROM captured WHERE $2::text IS NOT NULL ON CONFLICT DO NOTHING RETURNING id
    ) SELECT customer_id FROM captured`, [customerId, referralCode, eventId, JSON.stringify(metadata)]);
    return { accepted: captured.length > 0, reason: captured.length ? (referralCode ? "queued" : "organic") : "signup_already_closed" };
  }
  async function enqueue(event) {
    await rows(`INSERT INTO boomin_sdk_lead_events (id, customer_id, referral_code, program_key, metric_key, event_type, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
    [event.id, event.customerId || null, event.referralCode, event.programKey || null, event.metricKey, event.eventType, JSON.stringify(event.metadata || {})]);
  }
  async function claim(limit) {
    const token = crypto.randomUUID();
    const claimed = await rows(`WITH due AS (
      SELECT id FROM boomin_sdk_lead_events WHERE status = 'pending' AND next_attempt_at <= now()
        AND (lease_until IS NULL OR lease_until <= now())
      ORDER BY (metric_key = 'signups') DESC, next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE boomin_sdk_lead_events e SET lease_until = now() + interval '5 minutes', lease_token = $2,
      attempts = attempts + 1 FROM due WHERE e.id = due.id RETURNING e.*`, [limit, token]);
    return claimed.map((row) => ({ id: row.id, customerId: row.customer_id, referralCode: row.referral_code,
      programKey: row.program_key, metricKey: row.metric_key, eventType: row.event_type,
      occurredAt: new Date(row.occurred_at).toISOString(), metadata: row.metadata, attempts: row.attempts, leaseToken: row.lease_token }));
  }
  async function saveAttribution(id, code, program) {
    await rows(`UPDATE boomin_sdk_lead_customers SET referral_code = $2, program_key = $3
      WHERE customer_id = $1 AND candidate_referral_code = $2
      AND (referral_code IS NULL OR (referral_code = $2 AND program_key = $3))`, [id, code, program]);
  }
  async function complete(event, program) {
    const changed = await rows(`UPDATE boomin_sdk_lead_events SET status = 'delivered', program_key = $3,
      delivered_at = now(), last_error = NULL, lease_until = NULL, lease_token = NULL
      WHERE id = $1 AND lease_token = $2 AND status = 'pending' RETURNING id`, [event.id, event.leaseToken, program]);
    return changed.length > 0;
  }
  async function invalidate(event, reason) {
    await rows(`UPDATE boomin_sdk_lead_events SET status = 'invalid', last_error = $3,
      lease_until = NULL, lease_token = NULL WHERE id = $1 AND lease_token = $2 AND status = 'pending'`,
    [event.id, event.leaseToken, reason]);
  }
  async function retry(event, reason) {
    const delay = Math.min(3600, 30 * 2 ** Math.min(event.attempts, 7));
    await rows(`UPDATE boomin_sdk_lead_events SET last_error = $3, next_attempt_at = now() + $4 * interval '1 second',
      lease_until = NULL, lease_token = NULL WHERE id = $1 AND lease_token = $2 AND status = 'pending'`,
    [event.id, event.leaseToken, reason, delay]);
  }
  async function deliveryStatus({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Status limit must be 1–100.");
    const events = await rows(`SELECT id, customer_id, program_key, metric_key, status, attempts,
      last_error, occurred_at, delivered_at FROM boomin_sdk_lead_events ORDER BY occurred_at DESC LIMIT $1`, [limit]);
    const summary = await rows("SELECT status, count(*)::integer AS count FROM boomin_sdk_lead_events GROUP BY status");
    return { events, summary };
  }
  /** Only call from a trusted new-account event, inside its DB transaction.
   * The database trigger is preferable when the customer table is available. */
  async function openSignup({ customerId, createdAt }) {
    const created = new Date(createdAt);
    if (!customerId || !Number.isFinite(created.getTime())) throw new Error("openSignup requires a server-verified customerId and createdAt.");
    await rows(`INSERT INTO boomin_sdk_lead_customers (customer_id, capture_until)
      VALUES ($1, $2::timestamptz + interval '30 minutes') ON CONFLICT DO NOTHING`, [customerId, created.toISOString()]);
  }
  return { openSignup, getCustomer, captureSignup, enqueue, claim, saveAttribution, complete, invalidate, retry, deliveryStatus };
}

function identifier(value) {
  const parts = String(value).split(".");
  if (parts.length > 2 || parts.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) throw new Error("Use a valid schema/table identifier.");
  return parts.map((p) => `"${p}"`).join(".");
}
function literalColumn(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Use a valid customer ID column.");
  return `'${value}'`;
}

function validatePrefix(value) {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(value)) throw new Error("tablePrefix must be a lowercase SQL identifier, max 32 characters.");
}

function schemaIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("storageSchema must be a valid SQL schema identifier.");
  return `"${value}"`;
}
