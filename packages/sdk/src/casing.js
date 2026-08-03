/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  THE CASING BOUNDARY — the one file that knows the wire is snake_case.     │
 * │                                                                           │
 * │  @boomin/sdk speaks camelCase in BOTH directions. The REST wire speaks     │
 * │  snake_case. Everything that translates between the two lives here.       │
 * │                                                                           │
 * │  >>> API GREW A NESTED REQUEST STRUCTURE? EDIT `REQUEST_FIELD_MAP`.  <<<   │
 * │  >>> API GREW A CUSTOMER-OWNED BLOB?      EDIT `RESPONSE_FIELD_MAP`. <<<   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Both directions are driven by DECLARED SCHEMA, transcribed from
 * `api/src/routes/platform-v1/*.ts`. The SDK is already coupled to the API
 * contract; these two maps make the coupling explicit, greppable and
 * unit-testable instead of implicit in a regex.
 *
 * - `REQUEST_FIELD_MAP` declares, per request shape, which nested structures
 *   the API owns (`subjects[]`, `budget`) and which values are the caller's.
 *   A field the map does not declare has its VALUE passed through verbatim —
 *   the safe default, because a missed conversion is now a loud 400 from the
 *   API's sealed `.strict()` schemas, while an over-eager one silently
 *   corrupts a caller's own data.
 *
 * - `RESPONSE_FIELD_MAP` declares, per API object type, which of its fields
 *   hold customer-controlled data. Those contents are frozen; every other key
 *   converts. See the note on `OPAQUE_FIELDS` for why the customer-owned set
 *   is enforced at every depth and not only under its declared object.
 *
 * Ambiguity is never resolved silently in EITHER direction: a camelCase key
 * arriving alongside its snake_case twin throws `ConflictingParametersError`,
 * on the way out and on the way back.
 *
 * Neither direction ever touches VALUES. Ids, urls, and secrets are strings and
 * stay byte-identical.
 */

import { ConflictingParametersError } from "./errors.js";

// ── Key-level conversion ──────────────────────────────────────────────────────

/**
 * camelCase -> snake_case, but ONLY for well-formed lowerCamelCase identifiers
 * (`startingAfter`, `enabledEvents`). Anything else — already-snake_case keys,
 * PascalCase, dotted or hyphenated keys, keys with leading underscores — is
 * returned untouched, so this can never mangle a name it does not understand.
 */
export function toSnakeKey(key) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(key)) return key;
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * snake_case -> camelCase, the exact inverse of `toSnakeKey` over the keys it
 * produces. ONLY well-formed lower_snake_case identifiers convert: a key with
 * no underscore is already its own camelCase form and is returned as-is, and
 * anything malformed (`_leading`, `a__b`, `Mixed_Case`, `2fa_enabled`) is left
 * alone rather than guessed at.
 *
 * `toSnakeKey(toCamelKey(k)) === k` for every k this function converts.
 */
export function toCamelKey(key) {
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(key)) return key;
  return key.replace(/_([a-z0-9])/g, (_match, c) => c.toUpperCase());
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ── Customer-owned data: declared per API object ──────────────────────────────

/**
 * THE RESPONSE FIELD MAP. One entry per v1 object type (its `object`
 * discriminator), declaring which of that object's fields hold data the
 * CUSTOMER controls. Those fields' contents are not ours to rename — in either
 * direction.
 *
 * DERIVATION: transcribed from the serializers in
 * `api/src/routes/platform-v1/*.ts`. A field appears here iff the serializer
 * emits a `jsonb` column the API stores verbatim, or a
 * `z.record(z.string(), z.unknown())` the caller supplies.
 *
 * WHEN THE API ADDS A FREE-FORM BLOB: add it here. `OPAQUE_FIELDS` below is
 * computed from this map, so one edit covers both directions.
 */
export const RESPONSE_FIELD_MAP = Object.freeze({
  // distributions.ts serializeDistribution
  distribution: ["spec", "stats"],
  // distributions.ts serializeDeployment — adapter/provider-owned placement
  // config, its observed mirror, and a map keyed by provider-side identifiers.
  deployment: ["desired_state", "observed_state", "external_ids"],
  // distributions.ts serializeOperation — `result` embeds a deployment's
  // external_ids, so the name is declared here too and caught at depth.
  operation: ["external_ids"],
  // relationships.ts serializePartnership — customer-extensible terms
  partnership: ["permissions", "rights", "compensation_defaults"],
  // relationships.ts serializeEnrollment / serializeConnection
  // (connection.grants[].permissions is a per-grant permission map)
  enrollment: ["metadata"],
  connection: ["metadata", "permissions"],
  // partners.ts / programs.ts
  partner: ["metadata"],
  program: ["metadata"],
  "program.requirement": ["metadata"],
  "program.tier": ["metadata"],
  "program.connect_config": ["metadata"],
  // telemetry.ts — the caller's own analytics vocabulary
  performance_event: ["properties"],
  // No customer-owned fields; listed so the map is a complete census of the
  // v1 object vocabulary rather than a partial one.
  "performance.summary": [],
  event: [],
  webhook_endpoint: [],
  payout: [],
  payout_batch: [],
  payout_run: [],
  "payouts.connect_status": [],
  // payouts.ts serializeRule — `scope` is API-OWNED (a discriminated
  // {type, program|collection|unit|member}), so nothing here is frozen.
  payout_rule: [],
  // payouts.ts serializeRail / railConfigToWire — `config` is SPLIT, and only
  // half of it is ours:
  //
  //   config.format, config.wallet_funded  API-OWNED. They select a built-in
  //       CSV template and turn confirm into a guarded wallet debit. They
  //       convert like every other v1 field (`wallet_funded` <-> walletFunded).
  //
  //   config.columns                       CUSTOMER-OWNED. It is the caller's
  //       own column mapping and it is what a bank reads. Declared here so its
  //       CONTENTS are frozen at every depth: the entries keep their key names
  //       (`key`, `header`), their header VALUES, and their array ORDER exactly
  //       as the API returned them. A "helpfully" re-cased CSV header is a
  //       different file paying a different column — this is the one field on
  //       the payout surface where a rename is a money bug, not a cosmetic one.
  //
  // The NAME `config` still converts (it is API-owned); only what is inside
  // `columns` is untouchable. Enforcement is by name at every depth — see the
  // OPAQUE_FIELDS note — so a `columns` array survives wherever the server
  // nests it (a rail inside a webhook envelope, say).
  payout_rail: ["columns"],
  list: [],
});

/**
 * Every customer-owned field name, in BOTH spellings — computed from
 * RESPONSE_FIELD_MAP so the declaration above is the single source of truth.
 *
 * WHY THIS IS ENFORCED GLOBALLY, not only under its declared object type:
 * JSON carries no types at depth. `operation.result` embeds a deployment's
 * `external_ids` with no `object` discriminator of its own; a webhook envelope
 * nests a serialized resource under `data.object`. Scoping the exception
 * strictly by discriminator would leak customer keys wherever the server nests
 * a blob one level deeper than we anticipated — and a leak here means silently
 * renaming data the customer wrote. The declaration says WHERE each blob lives
 * and is what you edit; the union is how it is enforced.
 *
 * The field NAME itself is API-owned and still converts (`desired_state` <->
 * `desiredState`); only what is INSIDE it is frozen.
 *
 * Renaming a caller's `properties.orderId` to `properties.order_id` is exactly
 * the class of silent corruption this whole change exists to eliminate — just
 * pointed at the customer's data instead of ours.
 */
export const OPAQUE_FIELDS = new Set(
  Object.values(RESPONSE_FIELD_MAP)
    .flat()
    .flatMap((field) => [field, toCamelKey(field), toSnakeKey(field)]),
);

// ── The request field map ─────────────────────────────────────────────────────

/** A field whose value is passed through verbatim (see OPAQUE_FIELDS). */
const OPAQUE = Object.freeze({ kind: "opaque" });

/** An API-owned nested object: convert its keys, and its declared children. */
const nested = (fields = {}) => Object.freeze({ kind: "object", fields: Object.freeze(fields) });

/** An API-owned array whose elements share one declared shape. */
const arrayOf = (element) => Object.freeze({ kind: "array", element });

/**
 * THE FIELD MAP. One entry per request shape, keyed by the SDK method that
 * sends it (`resource.method`). The value declares the NESTED structures inside
 * that body — top-level keys always convert, so a flat body needs no entry at
 * all beyond documenting its opaque fields.
 *
 * DERIVATION: every entry below is a transcription of a zod schema in
 * `api/src/routes/platform-v1/*.ts`. A shape appears here only if its schema
 * declares a nested object/array or a `z.record(z.string(), z.unknown())` blob.
 * Everything else in the v1 request surface is scalars and arrays of strings.
 *
 * WHEN THE API ADDS A NESTED STRUCTURE: add it here, or the SDK will pass the
 * caller's camelCase spelling straight through and the API's sealed `.strict()`
 * schema will answer 400 naming the field. Loud, not silent — but still wrong.
 */
export const REQUEST_FIELD_MAP = Object.freeze({
  // api/src/routes/platform-v1/programs.ts — programCreateSchema / programUpdateSchema
  "programs.create": { metadata: OPAQUE },
  "programs.update": { metadata: OPAQUE },
  // programs.ts — requirementCreateSchema / requirementUpdateSchema
  "programs.requirements.create": { metadata: OPAQUE },
  "programs.requirements.update": { metadata: OPAQUE },
  // programs.ts — tierCreateSchema / tierUpdateSchema
  "programs.tiers.create": { metadata: OPAQUE },
  "programs.tiers.update": { metadata: OPAQUE },
  // programs.ts — connectConfigSchema (allowed_origins etc. are string[])
  "programs.connectConfig.update": { metadata: OPAQUE },
  // programs.ts — handoffConfigSchema
  "programs.handoffConfig.update": { metadata: OPAQUE },

  // api/src/routes/platform-v1/relationships.ts — permissionsSchema.
  // All three are z.record(z.string(), z.unknown()): customer-extensible terms.
  "partnerships.updatePermissions": {
    permissions: OPAQUE,
    rights: OPAQUE,
    compensation_defaults: OPAQUE,
  },
  // relationships.ts — inviteSchema
  "enrollments.create": { metadata: OPAQUE },

  // api/src/routes/platform-v1/distributions.ts — createSchema / updateSchema.
  // The only two API-OWNED nested structures in the whole v1 request surface:
  //   subjectSchema = z.object({ kind, id, role }).strict()
  //   budgetSchema  = z.object({ mode, asset, total, total_minor, totalMinor }).strict()
  // Both are sealed server-side, so a stray camelCase key inside them 400s at
  // its real path (`subjects.0.subjectKind`) — converting them here means the
  // SDK fixes what it can instead of only failing loudly.
  "distributions.create": {
    subjects: arrayOf(nested()),
    budget: nested(),
    spec: OPAQUE,
  },
  "distributions.update": {
    budget: nested(),
    spec: OPAQUE,
  },

  // api/src/routes/platform-v1/telemetry.ts — ingestSchema
  "performance.events.create": { properties: OPAQUE },

  // api/src/routes/platform-v1/webhooks.ts — createSchema / updateSchema.
  // `enabled_events` is z.array(z.string()): a flat list, nothing to recurse.
  "webhooks.endpoints.create": {},
  "webhooks.endpoints.update": {},

  // api/src/routes/platform-v1/payouts.ts — runSchema / exportSchema: flat.
  "payouts.run": {},
  "payouts.exportCsv": {},

  // payouts.ts — ruleCreateSchema. `scope` is the discriminated API-OWNED
  // object that replaced the raw applies_to / scope_id / program_id triple:
  //   ruleScopeSchema = z.object({ type, program, collection?, unit?, member? }).strict()
  // Every key in it is the API's, so every key converts. It is sealed
  // server-side, so an unconverted spelling would 400 at `scope.<field>`.
  "payouts.rules.create": { scope: nested() },
  // ruleUpdateSchema accepts only {name?, status?} — flat, and every other
  // field is answered with `immutable_parameter`.
  "payouts.rules.update": {},
  "payouts.rules.archive": {},

  // payouts.ts — railCreateSchema / railUpdateSchema.
  //
  // `config` is TWO THINGS and is declared as two things (the mirror of the
  // RESPONSE_FIELD_MAP note above):
  //   - the config OBJECT is API-owned, so `walletFunded` must go out as
  //     `wallet_funded` and `format` must reach the sealed schema intact;
  //   - `columns` is the CALLER'S data and goes out byte-for-byte. A boundary
  //     that rewrote `{ key, header }` — or a `header` a customer spelled
  //     "Email Address" — would change the file their bank ingests.
  //
  // Declaring the object without declaring `columns` opaque would be the
  // money bug; declaring nothing at all would send `walletFunded` to a
  // `.strict()` schema and 400. Both halves are required.
  "payouts.rails.create": { config: nested({ columns: OPAQUE }) },
  "payouts.rails.update": { config: nested({ columns: OPAQUE }) },

  // payouts.ts — batchCreateSchema / batchConfirmSchema.
  // `results` is an API-owned array of sealed {item, status, reason} objects.
  "payouts.batches.create": {},
  "payouts.batches.export": {},
  "payouts.batches.confirm": { results: arrayOf(nested()) },
  "payouts.batches.cancel": {},
});

// ── Request serialization ─────────────────────────────────────────────────────

function joinPath(path, key) {
  return path ? `${path}.${key}` : key;
}

/**
 * Convert one object's keys to the wire's snake_case form, recursing only where
 * the declared shape says to.
 *
 * Throws `ConflictingParametersError` the moment a camelCase key and its
 * snake_case twin both appear. Picking a winner silently would repeat the exact
 * mistake this work exists to eliminate: ambiguous caller intent, resolved out
 * of sight. It is always a caller bug, and it is always cheap to say so.
 */
function snakeCaseObject(value, fields, path) {
  const converted = {};
  for (const rawKey of Object.keys(value)) {
    const key = toSnakeKey(rawKey);
    if (key !== rawKey && Object.prototype.hasOwnProperty.call(value, key)) {
      throw conflictingParameters(path, rawKey, key);
    }
    const descriptor = fields[key] ?? OPAQUE;
    converted[key] = applyRequestDescriptor(value[rawKey], descriptor, joinPath(path, key));
  }
  return converted;
}

function applyRequestDescriptor(value, descriptor, path) {
  if (descriptor.kind === "object") {
    return isPlainObject(value) ? snakeCaseObject(value, descriptor.fields, path) : value;
  }
  if (descriptor.kind === "array") {
    return Array.isArray(value)
      ? value.map((item, index) => applyRequestDescriptor(item, descriptor.element, `${path}.${index}`))
      : value;
  }
  return value;
}

/**
 * The typed error for a camel/snake twin pair, raised in BOTH directions:
 * client-side before a request is issued, and while deserializing a response
 * that carried both spellings of one field.
 */
export function conflictingParameters(path, camelKey, snakeKey, direction = "request") {
  const at = (key) => (path ? `${path}.${key}` : key);
  const advice = direction === "response"
    ? "The API returned both spellings of one field, so its value is ambiguous. " +
      "This is a server bug — report it with the request id."
    : "Send one or the other — @boomin/sdk converts camelCase to the snake_case wire form for you.";
  return new ConflictingParametersError(
    `"${at(camelKey)}" and "${at(snakeKey)}" refer to the same API field. ${advice}`,
    { code: "conflicting_parameters", param: at(camelKey), conflictsWith: at(snakeKey), direction },
  );
}

/**
 * Convert a request body to the API's snake_case wire form.
 *
 * @param {unknown} body The caller's params object.
 * @param {string} [shape] Key into REQUEST_FIELD_MAP (`"distributions.create"`).
 *   Omitted/unknown means "top-level keys only" — the safe default.
 */
export function snakeCaseBody(body, shape) {
  if (!isPlainObject(body)) return body;
  return snakeCaseObject(body, REQUEST_FIELD_MAP[shape] ?? {}, "");
}

/**
 * Serialize query params. camelCase keys convert to the wire's snake_case form
 * (`startingAfter` -> `starting_after`); a camel/snake twin pair throws the same
 * ConflictingParametersError a body does; null/undefined values are dropped;
 * arrays repeat the key.
 */
export function buildQueryString(query) {
  if (!isPlainObject(query)) return "";
  const search = new URLSearchParams();
  for (const rawKey of Object.keys(query)) {
    const key = toSnakeKey(rawKey);
    if (key !== rawKey && Object.prototype.hasOwnProperty.call(query, key)) {
      throw conflictingParameters("", rawKey, key);
    }
    const value = query[rawKey];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

// ── Response deserialization ──────────────────────────────────────────────────

/**
 * Convert an API response to idiomatic camelCase.
 *
 * - KEYS ONLY. Values — ids, urls, secrets, timestamps — are untouched.
 * - List envelopes come along for free: `{object, data, has_more}` becomes
 *   `{object, data, hasMore}` with every element converted.
 * - Inside a customer-owned field (RESPONSE_FIELD_MAP / OPAQUE_FIELDS) nothing
 *   is renamed at any depth, so `properties.orderId` reads back as
 *   `properties.orderId`.
 * - A snake_case key arriving alongside its camelCase twin THROWS
 *   `ConflictingParametersError`, exactly as it does on the request side.
 *   Picking a winner is the sin this work exists to eliminate, and it does not
 *   become acceptable just because the ambiguity came from the server.
 */
export function camelCaseResponse(value, path = "") {
  if (Array.isArray(value)) return value.map((item, index) => camelCaseResponse(item, `${path}.${index}`));
  if (!isPlainObject(value)) return value;
  const converted = {};
  for (const rawKey of Object.keys(value)) {
    const camel = toCamelKey(rawKey);
    if (camel !== rawKey && Object.prototype.hasOwnProperty.call(value, camel)) {
      throw conflictingParameters(path, camel, rawKey, "response");
    }
    converted[camel] = OPAQUE_FIELDS.has(rawKey)
      ? value[rawKey]
      : camelCaseResponse(value[rawKey], joinPath(path, camel));
  }
  return converted;
}
