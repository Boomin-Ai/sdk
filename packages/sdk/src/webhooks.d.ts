import type { BoominEvent } from "./index.js";

export const DEFAULT_TOLERANCE_SECONDS: number;

export interface ConstructEventOptions {
  /** Max allowed signature age in seconds (default 300). `0` disables the check. */
  tolerance?: number;
  /** Clock override in unix seconds (testing). */
  now?: number;
  /**
   * Return the wire's raw snake_case payload instead of camelCasing it.
   * Default false — a verified event reads like every other SDK value
   * (`event.data.object.valueMinor`), with customer-owned blobs untouched.
   */
  raw?: boolean;
}

/**
 * Verify a `Boomin-Signature: t=<ts>,v1=<hmac>` header (HMAC-SHA256 over
 * `${t}.${rawPayload}`) and return the parsed event.
 *
 * - Pass the RAW request body — never a re-serialized parse.
 * - `secret` accepts an array during secret rotation; the header may equally
 *   carry multiple `v1=` entries (platform-side rotation overlap).
 * - Async (WebCrypto): `await` the result.
 * - The returned event is camelCased (keys only); pass `{ raw: true }` for the
 *   wire shape. Signature verification always runs over the raw bytes.
 *
 * @throws WebhookSignatureVerificationError on any verification failure.
 */
export function constructEvent(
  payload: string | Uint8Array | ArrayBuffer,
  sigHeader: string,
  secret: string | string[],
  options?: ConstructEventOptions,
): Promise<BoominEvent>;
