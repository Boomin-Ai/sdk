/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  THE CASING BOUNDARY — the one file that knows the wire is snake_case.     │
 * │                                                                            │
 * │  @boomin/sdk speaks camelCase in BOTH directions. The REST wire speaks      │
 * │  snake_case. Everything that translates between the two lives here.        │
 * │                                                                            │
 * │  >>> ADDING A NESTED STRUCTURE TO THE API? EDIT `REQUEST_FIELD_MAP`. <<<   │
 * │  >>> ADDING A CUSTOMER-OWNED FREE-FORM BLOB?  EDIT `OPAQUE_FIELDS`.   <<<  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Two rules, and they are deliberately not symmetric in HOW they are declared:
 *
 * 1. REQUESTS convert by DECLARED SCHEMA (`REQUEST_FIELD_MAP`), never by
 *    structural guesswork. The SDK is already coupled to the API contract; this
 *    file makes the coupling explicit, greppable, and unit-testable. A field the
 *    map does not declare has its VALUE passed through verbatim — the safe
 *    default, because the cost of a missed conversion is now a loud 400 from the
 *    API's sealed `.strict()` schemas, while the cost of an over-eager
 *    conversion is silently corrupting a caller's own data.
 *
 * 2. RESPONSES convert RECURSIVELY by structure, with an explicit exception list
 *    (`OPAQUE_FIELDS`). There is no schema to declare against on the way back —
 *    the server can add fields at any time, and a response object the SDK failed
 *    to convert would be an invisible snake_case island in an otherwise camelCase
 *    result. Recursion is right here precisely because the exception list is the
 *    thing that carries the risk, and it is short and named.
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

// ── Customer-owned opaque payloads ────────────────────────────────────────────

/**
 * Fields whose CONTENTS are not ours to rename, in EITHER direction. Their keys
 * round-trip byte-identical: what the caller writes is what the API stores is
 * what the SDK hands back.
 *
 * The field name itself is API-owned and still converts (`desired_state` <->
 * `desiredState`); only what is INSIDE it is frozen.
 *
 * Renaming a caller's `properties.orderId` to `properties.order_id` is exactly
 * the class of silent corruption this whole change exists to eliminate — just
 * pointed at the customer's data instead of ours.
 *
 * Both spellings are listed so the set answers correctly on the request side
 * (caller wrote camelCase) and the response side (server wrote snake_case).
 */
export const OPAQUE_FIELDS = new Set([
  // Arbitrary customer key/values. Never read by the API.
  "metadata",
  // Arbitrary event properties on performance.events.create — the customer's
  // own analytics vocabulary.
  "properties",
  // The distribution's declarative plan. Adapters read known sub-keys; unknown
  // ones round-trip untouched, so it is customer-extensible by design.
  "spec",
  // Partnership terms: structured, but customer-extensible.
  "permissions",
  "rights",
  "compensation_defaults", "compensationDefaults",
  // Adapter-specific placement config and its provider-reported mirror. Keys
  // here belong to whichever provider the deployment runs on, not to us.
  "desired_state", "desiredState",
  "observed_state", "observedState",
  // Map keyed by provider-side identifiers.
  "external_ids", "externalIds",
  // Metric-keyed rollup. The keys include customer-defined event types, so this
  // is a map-like record keyed by user data.
  "stats",
]);

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

/** The typed client-side error for a camel/snake twin pair. */
export function conflictingParameters(path, camelKey, snakeKey) {
  const at = (key) => (path ? `${path}.${key}` : key);
  return new ConflictingParametersError(
    `"${at(camelKey)}" and "${at(snakeKey)}" refer to the same API field. ` +
      "Send one or the other — @boomin/sdk converts camelCase to the snake_case wire form for you.",
    { code: "conflicting_parameters", param: at(camelKey), conflictsWith: at(snakeKey) },
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
 * Convert an API response to idiomatic camelCase, recursively.
 *
 * - KEYS ONLY. Values — ids, urls, secrets, timestamps — are untouched.
 * - List envelopes come along for free: `{object, data, has_more}` becomes
 *   `{object, data, hasMore}` with every element converted.
 * - Inside an OPAQUE_FIELDS value nothing is renamed at any depth, so a
 *   caller's `properties.orderId` reads back as `properties.orderId`.
 * - If the server ever sent a snake_case key AND its camelCase twin in the same
 *   object, the snake_case one keeps its own name rather than overwriting the
 *   twin: converting must never lose a field.
 */
export function camelCaseResponse(value) {
  if (Array.isArray(value)) return value.map(camelCaseResponse);
  if (!isPlainObject(value)) return value;
  const converted = {};
  for (const rawKey of Object.keys(value)) {
    const raw = value[rawKey];
    const inner = OPAQUE_FIELDS.has(rawKey) ? raw : camelCaseResponse(raw);
    const camel = toCamelKey(rawKey);
    const collides = camel !== rawKey && Object.prototype.hasOwnProperty.call(value, camel);
    converted[collides ? rawKey : camel] = inner;
  }
  return converted;
}
