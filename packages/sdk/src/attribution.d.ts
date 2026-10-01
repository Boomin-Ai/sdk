export interface Attribution { referralCode: string; capturedAt: number; expiresAt: number }
export interface AttributionOptions {
  windowDays?: number; storageKey?: string; referralParam?: string; cleanUrl?: boolean;
  window?: Window; now?: () => number;
}
export function normalizeReferralCode(value: unknown): string | null;
export function createAttribution(options?: AttributionOptions): {
  capture(): Attribution | null; get(): Attribution | null; clear(): void;
};
