export interface LeadCustomer {
  customerId: string; candidateReferralCode: string | null; referralCode: string | null;
  programKey: string | null; capturedAt?: string | Date | null;
}
export interface LeadEvent {
  id: string; customerId?: string | null; referralCode: string; programKey?: string | null;
  metricKey: string; eventType: string; metadata: Record<string, unknown>;
  occurredAt: string; attempts: number; leaseToken: string;
}
export interface SignupCaptureResult { accepted: boolean; reason: string }
export interface LeadStore {
  captureSignup(input: { customerId: string; referralCode: string | null; eventId: string; metadata: Record<string, unknown> }): Promise<SignupCaptureResult>;
  getCustomer(id: string): Promise<LeadCustomer | null>;
  enqueue(event: { id: string; customerId?: string; referralCode: string; programKey?: string; metricKey: string; eventType: string; metadata?: Record<string, unknown> }): Promise<void>;
  claim(limit: number): Promise<LeadEvent[]>;
  saveAttribution(customerId: string, referralCode: string, programKey: string): Promise<void>;
  complete(event: LeadEvent, programKey: string): Promise<boolean>;
  invalidate(event: LeadEvent, reason: string): Promise<void>;
  retry(event: LeadEvent, reason: string): Promise<void>;
}
export interface LeadProgram { key: string; publicKey: string; programId?: string; signingSecret: string }
export interface LeadTracker {
  recordSignup(input: { customerId: string; referralCode?: string | null; metadata?: Record<string, unknown> }): Promise<SignupCaptureResult>;
  recordClick(input: { referralCode: string; eventId?: string; metadata?: Record<string, unknown> }): Promise<{ accepted: boolean; eventId?: string; reason?: string }>;
  recordQualifiedLead(input: { customerId: string; eventId: string; programKey: string; metricKey?: string; metadata?: Record<string, unknown> }): Promise<{ accepted: boolean; eventId?: string; reason?: string }>;
  deliver(options?: { limit?: number }): Promise<{ attempted: number; delivered: number; invalid: number; pending: number }>;
}
export interface LeadTrackerOptions {
  store: LeadStore; issuer: string; programs: LeadProgram[]; apiBase?: string;
  transport?: {
    getStanding(options: { issuer: string; apiBase?: string; publicKey: string; programId?: string; signingSecret: string }): Promise<{ entities?: Array<{ referralCode?: string; referral?: { code?: string } }> }>;
    postProgramEvent(options: { issuer: string; apiBase?: string; signingSecret: string; body: Record<string, unknown> }): Promise<unknown>;
  };
}
export function createLeadTracker(options: LeadTrackerOptions): LeadTracker;
