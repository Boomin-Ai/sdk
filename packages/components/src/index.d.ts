export type ConsoleSection = "general" | "kit" | "integrations" | "members" | "payments" | "billing" | "developer" | "danger";

export type ConsoleTheme =
  | "light"
  | "dark"
  | ({ mode?: "light" | "dark" } & Record<string, string>);

export interface ConsoleMountOptions {
  /** One-time code — from POST /v1/app/auth/handoff (desktop) or `@boomin/sdk` consoleSessions.create (your backend). */
  handoff?: string;
  /** Or an existing user session token. */
  token?: string;
  /** The brand slug the console acts as. */
  brand: string;
  /** Initial section. Default "general". */
  section?: ConsoleSection | string;
  /** API origin, e.g. "https://api.boomin.ai". */
  apiBase?: string;
  /** Light/dark, or a map of shadcn-named CSS variables (background, foreground, primary, …). */
  theme?: ConsoleTheme;
  /** Hosted flows (Stripe onboarding, Checkout, the Express dashboard). Required in a desktop host. */
  onExternal?: (url: string, opts: { newTab: boolean }) => void;
  onNavigate?: (section: string) => void;
  onAuthExpired?: () => void;
  onReady?: () => void;
}

export interface MountedConsole {
  unmount(): void;
  navigate(section: ConsoleSection | string): void;
}

export interface RuntimeOptions {
  /** Origin that serves /components/v1.js. Default https://boomin.ai */
  base?: string;
}

export interface ComponentsRuntime {
  contract: number;
  base: string;
  load(name: string): Promise<unknown>;
  mount(name: "console", el: HTMLElement, options: ConsoleMountOptions): Promise<MountedConsole>;
  mount(name: string, el: HTMLElement, options: Record<string, unknown>): Promise<unknown>;
}

export declare const CONTRACT: number;
export declare function loadRuntime(options?: RuntimeOptions): Promise<ComponentsRuntime>;
export declare function mount(name: "console", el: HTMLElement, options: ConsoleMountOptions & RuntimeOptions): Promise<MountedConsole>;
export declare function mount(name: string, el: HTMLElement, options: Record<string, unknown> & RuntimeOptions): Promise<unknown>;

declare const _default: { mount: typeof mount; loadRuntime: typeof loadRuntime; CONTRACT: number };
export default _default;
