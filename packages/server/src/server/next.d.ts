import type { BoominHandoffUser } from "../server";

export interface BoominNextHandoffOptions {
  publicKey: string;
  programId: string;
  redirectUri: string;
  signingSecret: string;
  issuer: string;
  audience?: string;
  apiBase?: string;
  loginUrl?: string;
  getCurrentUser: (request: Request) => Promise<BoominHandoffUser | null> | BoominHandoffUser | null;
}

export function createBoominCreatorJoinHandler(options: BoominNextHandoffOptions): (request: Request) => Promise<Response>;
