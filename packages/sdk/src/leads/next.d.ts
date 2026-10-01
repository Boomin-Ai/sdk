import type { LeadTracker } from "../leads";
export function createLeadSignupHandler(options: {
  tracker: LeadTracker; allowedOrigins: string[];
  getCurrentCustomer: (request: Request) => Promise<{ customerId: string } | null> | { customerId: string } | null;
}): (request: Request) => Promise<Response>;
export function createReferralRedirectHandler(options: {
  tracker: LeadTracker; destinationUrl: string; onError?: (error: unknown) => void;
}): (request: Request, context: { params: { code: string } | Promise<{ code: string }> }) => Promise<Response>;
