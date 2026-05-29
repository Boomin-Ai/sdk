export type BoominConnectEvent =
  | "ready"
  | "auth:otp_sent"
  | "auth:verified"
  | "creator:pending"
  | "connect:start"
  | "connect:redirect"
  | "connect:joined"
  | "connect:needs_instagram"
  | "connect:needs_channel"
  | "connect:qualified"
  | "connect:not_qualified"
  | "connect:grace"
  | "connect:connected"
  | "connect:pending_approval"
  | "connect:approved"
  | "connect:error";

export interface BoominInitOptions {
  publicKey: string;
  programId?: string;
  redirectUri?: string;
  apiBase?: string;
  timeoutMs?: number;
}

export interface BoominConnectOptions {
  referralCode?: string | null;
  metadata?: Record<string, unknown>;
  redirectUri?: string;
  programId?: string;
  requireCreator?: boolean;
  mode?: "redirect" | "popup" | "manual";
  popupName?: string;
}

export interface BoominRequestOtpOptions {
  email: string;
  name?: string;
  phone?: string;
  referralCode?: string | null;
  metadata?: Record<string, unknown>;
  programId?: string;
}

export interface BoominVerifyOtpOptions extends BoominRequestOtpOptions {
  code: string;
}

export interface BoominJoinProgramOptions {
  email?: string;
  name?: string;
  phone?: string;
  referralCode?: string | null;
  metadata?: Record<string, unknown>;
  programId?: string;
}

export interface BoominProgramStatusOptions {
  programId?: string;
  sessionId?: string;
}

export interface BoominCreatorAuthResult {
  success?: boolean;
  auth_token?: string;
  token?: string;
  status?: "pending" | "approved" | "rejected" | string;
  creator?: Record<string, unknown>;
  user?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  member?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BoominConnectSession {
  sessionId: string;
  state?: string;
  authUrl: string;
  popup?: Window | null;
}

export interface BoominConnectStatus {
  status: "joined" | "needs_instagram" | "needs_channel" | "created" | "oauth_started" | "connected" | "pending_approval" | "approved" | "rejected" | "qualified" | "not_qualified" | "grace" | "failed";
  sessionId?: string;
  session_id?: string;
  username?: string | null;
  error?: string | null;
  errorDetail?: string | null;
  referral?: {
    code: string;
    url: string;
    active: boolean;
  };
  metrics?: {
    linkClicks: number;
    signups: number;
    sales: number;
    gmvCents: number;
    productUsage: number;
  };
  approvalStatus?: "pending" | "approved" | "rejected" | string;
  qualificationStatus?: "pending" | "qualified" | "not_qualified" | "grace" | string;
  requiredChannels?: string[];
  missingChannels?: string[];
  channelStatus?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BoominAttachButtonOptions extends BoominConnectOptions {
  label?: string;
  loadingLabel?: string;
  connectedLabel?: string;
  pendingLabel?: string;
  errorLabel?: string;
  className?: string;
  onError?: (error: unknown) => void;
}

export interface BoominAttachedButton {
  element: Element;
  destroy: () => void;
}

export interface BoominClient {
  init(options: BoominInitOptions): BoominClient;
  on(eventName: BoominConnectEvent | string, handler: (payload: unknown) => void): () => void;
  off(eventName: BoominConnectEvent | string, handler: (payload: unknown) => void): BoominClient;
  getConfig(): Promise<Record<string, unknown>>;
  requestOtp(options: BoominRequestOtpOptions): Promise<Record<string, unknown>>;
  verifyOtp(options: BoominVerifyOtpOptions): Promise<BoominCreatorAuthResult>;
  getCurrentCreator(): Promise<BoominCreatorAuthResult>;
  joinProgram(options?: BoominJoinProgramOptions): Promise<BoominConnectStatus>;
  getProgramStatus(options?: BoominProgramStatusOptions): Promise<BoominConnectStatus>;
  connectChannel(provider: "instagram" | string, options?: BoominConnectOptions): Promise<BoominConnectSession>;
  connectInstagram(options?: BoominConnectOptions): Promise<BoominConnectSession>;
  getConnectStatus(sessionId: string): Promise<BoominConnectStatus>;
  attachConnectButton(selectorOrElement: string | Element, options?: BoominAttachButtonOptions): BoominAttachedButton;
  consumeRedirectResult(): BoominConnectStatus | null;
}

export const Boomin: BoominClient;
export function init(options: BoominInitOptions): BoominClient;
export function requestOtp(options: BoominRequestOtpOptions): Promise<Record<string, unknown>>;
export function verifyOtp(options: BoominVerifyOtpOptions): Promise<BoominCreatorAuthResult>;
export function getCurrentCreator(): Promise<BoominCreatorAuthResult>;
export function joinProgram(options?: BoominJoinProgramOptions): Promise<BoominConnectStatus>;
export function getProgramStatus(options?: BoominProgramStatusOptions): Promise<BoominConnectStatus>;
export function connectChannel(provider: "instagram" | string, options?: BoominConnectOptions): Promise<BoominConnectSession>;
export function connectInstagram(options?: BoominConnectOptions): Promise<BoominConnectSession>;
export function getConnectStatus(sessionId: string): Promise<BoominConnectStatus>;
export function attachConnectButton(selectorOrElement: string | Element, options?: BoominAttachButtonOptions): BoominAttachedButton;
export function on(eventName: BoominConnectEvent | string, handler: (payload: unknown) => void): () => void;
export default Boomin;
