import type { LeadStore } from "../leads";
export interface PostgresLeadStore extends LeadStore {
  openSignup(input: { customerId: string; createdAt: string | number | Date }): Promise<void>;
  deliveryStatus(options?: { limit?: number }): Promise<{ events: Record<string, unknown>[]; summary: Array<{ status: string; count: number }> }>;
}
export function leadTrackingMigration(options?: { customerTable?: string; customerIdColumn?: string; tablePrefix?: string; storageSchema?: string }): string;
export function createPostgresLeadStore(options: {
  tablePrefix?: string; storageSchema?: string;
  query: (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] } | Record<string, unknown>[]>;
}): PostgresLeadStore;
