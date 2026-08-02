import type { BoominEvent } from "./index.js";

export const DEFAULT_TOLERANCE_SECONDS: number;

export interface ConstructEventOptions {
  /** Max allowed signature age in seconds (default 300). `0` disables the check. */
  tolerance?: number;
  /** Clock override in unix seconds (testing). */
  now?: number;
}

/**
 * Verify a `Boomin-Signature: t=<ts>,v1=<hmac>` header (HMAC-SHA256 over
 * `${t}.${rawPayload}`) and return the parsed event.
 *
 * - Pass the RAW request body — never a re-serialized parse.
 * - `secret` accepts an array during secret rotation; the header may equally
 *   carry multiple `v1=` entries (platform-side rotation overlap).
 * - Async (WebCrypto): `await` the result.
 *
 * @throws WebhookSignatureVerificationError on any verification failure.
 */
export function constructEvent(
  payload: string | Uint8Array | ArrayBuffer,
  sigHeader: string,
  secret: string | string[],
  options?: ConstructEventOptions,
): Promise<BoominEvent>;
