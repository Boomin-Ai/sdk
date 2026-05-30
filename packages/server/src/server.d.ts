export interface BoominHandoffUser {
  externalUserId: string;
  email: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface BoominHandoffOptions extends BoominHandoffUser {
  publicKey: string;
  programId?: string;
  redirectUri: string;
  signingSecret: string;
  issuer: string;
  audience?: string;
  nonce?: string;
  expiresInSeconds?: number;
  apiBase?: string;
}

export interface BoominHandoffPayload {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nonce: string;
  publicKey: string;
  programId?: string;
  redirectUri: string;
  externalUserId: string;
  email: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface BoominSignedHandoff {
  payload: BoominHandoffPayload;
  signature: string;
  signingAlg: "HMAC-SHA256";
}

export interface BoominProgramEventOptions {
  apiBase?: string;
  issuer: string;
  signingSecret: string;
  event?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface BoominStandingOptions {
  apiBase?: string;
  publicKey: string;
  programId?: string;
  issuer: string;
  audience?: string;
  signingSecret: string;
  externalUserId?: string;
  nonce?: string;
  expiresInSeconds?: number;
  payload?: Record<string, unknown>;
  signature?: string;
}

export interface BoominMetricEventHelperOptions {
  apiBase?: string;
  issuer: string;
  signingSecret: string;
  publicKey: string;
  programId?: string;
  partnerRef: string;
  eventId?: string;
  eventType?: string;
  amount?: number;
  saleCount?: number;
  gmvCents?: number;
  gmvEventType?: string;
  currency?: string;
  occurredAt?: string | number | Date;
  metadata?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function stableJson(value: unknown): string;
export function createHandoffPayload(options: BoominHandoffOptions): BoominHandoffPayload;
export function signHandoffPayload(payload: BoominHandoffPayload, signingSecret: string): Promise<string>;
export function createSignedHandoff(options: BoominHandoffOptions): Promise<BoominSignedHandoff>;
export function postHandoff(options: BoominHandoffOptions | { apiBase?: string; payload: BoominHandoffPayload; signature: string }): Promise<Record<string, unknown>>;
export function postProgramEvent(options: BoominProgramEventOptions): Promise<Record<string, unknown>>;
export function createStandingPayload(options: Omit<BoominStandingOptions, "signingSecret">): Record<string, unknown>;
export function getPartnerStanding(options: BoominStandingOptions): Promise<Record<string, unknown>>;
export function recordReferralClick(options: BoominMetricEventHelperOptions): Promise<Record<string, unknown>>;
export function recordSignup(options: BoominMetricEventHelperOptions): Promise<Record<string, unknown>>;
export function recordSale(options: BoominMetricEventHelperOptions): Promise<Record<string, unknown>>;
export function recordProductUsage(options: BoominMetricEventHelperOptions): Promise<Record<string, unknown>>;
