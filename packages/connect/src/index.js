const DEFAULT_API_BASE = "https://api.boomin.ai/v1/connect";
const DEFAULT_TIMEOUT_MS = 15000;
const REDIRECT_RESULT_KEY = "boomin_connect_redirect_result";
const TOKEN_STORAGE_PREFIX = "boomin_connect_token";

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

class BoominConnectClient {
  constructor() {
    this.config = null;
    this.handlers = new Map();
    this.lastSessionId = null;
    this.ready = false;
  }

  init(options) {
    if (!options || typeof options !== "object") {
      throw new Error("Boomin.init requires a configuration object.");
    }
    if (!options.publicKey || typeof options.publicKey !== "string") {
      throw new Error("Boomin.init requires a publicKey. Run `npx @boomin/cli init` to create your Boomin program config.");
    }

    this.config = {
      publicKey: options.publicKey,
      programId: options.programId,
      redirectUri: options.redirectUri || (isBrowser() ? window.location.href : undefined),
      apiBase: stripTrailingSlash(options.apiBase || DEFAULT_API_BASE),
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    };
    this.ready = true;
    this.emit("ready", { config: publicClientConfig(this.config) });
    this.consumeRedirectResult();
    return this;
  }

  on(eventName, handler) {
    if (typeof handler !== "function") {
      throw new Error("Boomin.on requires a handler function.");
    }
    const handlers = this.handlers.get(eventName) || new Set();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);
    return () => handlers.delete(handler);
  }

  off(eventName, handler) {
    const handlers = this.handlers.get(eventName);
    if (handlers) handlers.delete(handler);
    return this;
  }

  async getConfig() {
    const config = this.requireConfig();
    const url = new URL(`${config.apiBase}/config`);
    url.searchParams.set("publicKey", config.publicKey);
    if (config.programId) url.searchParams.set("programId", config.programId);
    return this.request(url.toString(), { method: "GET" });
  }

  async requestOtp(options = {}) {
    const config = this.requireConfig();
    if (!options.email) throw new Error("Boomin.requestOtp requires an email.");

    try {
      const result = await this.request(`${config.apiBase}/auth/otp`, {
        method: "POST",
        body: JSON.stringify(removeEmpty({
          publicKey: config.publicKey,
          programId: options.programId || config.programId,
          email: options.email,
          name: options.name,
          phone: options.phone,
          referralCode: options.referralCode,
          metadata: options.metadata || {},
        })),
      });
      this.emit("auth:otp_sent", result);
      return result;
    } catch (error) {
      this.emitConnectError(error);
      throw error;
    }
  }

  async verifyOtp(options = {}) {
    const config = this.requireConfig();
    if (!options.email) throw new Error("Boomin.verifyOtp requires an email.");
    if (!options.code) throw new Error("Boomin.verifyOtp requires a code.");

    try {
      const result = await this.request(`${config.apiBase}/auth/verify`, {
        method: "POST",
        body: JSON.stringify(removeEmpty({
          publicKey: config.publicKey,
          programId: options.programId || config.programId,
          email: options.email,
          code: options.code,
          name: options.name,
          phone: options.phone,
          referralCode: options.referralCode,
          metadata: options.metadata || {},
        })),
      });
      const token = result.auth_token || result.token;
      if (token) this.setStoredToken(token);
      this.emit("auth:verified", result);
      if (result.status === "pending" || result.member?.approval_status === "pending") {
        this.emit("creator:pending", result);
      }
      return result;
    } catch (error) {
      this.emitConnectError(error);
      throw error;
    }
  }

  async getCurrentCreator() {
    const config = this.requireConfig();
    const url = new URL(`${config.apiBase}/me`);
    url.searchParams.set("publicKey", config.publicKey);
    if (config.programId) url.searchParams.set("programId", config.programId);
    const result = await this.request(url.toString(), {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (result.status === "pending" || result.member?.approval_status === "pending") {
      this.emit("creator:pending", result);
    }
    return result;
  }

  async joinProgram(options = {}) {
    const config = this.requireConfig();
    try {
      const result = await this.request(`${config.apiBase}/join`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(removeEmpty({
          publicKey: config.publicKey,
          programId: options.programId || config.programId,
          email: options.email,
          name: options.name,
          phone: options.phone,
          referralCode: options.referralCode,
          metadata: options.metadata || {},
        })),
      });
      this.emitStatus(result);
      return result;
    } catch (error) {
      this.emitConnectError(error);
      throw error;
    }
  }

  async getProgramStatus(options = {}) {
    const config = this.requireConfig();
    const url = new URL(`${config.apiBase}/status`);
    url.searchParams.set("publicKey", config.publicKey);
    if (options.programId || config.programId) url.searchParams.set("programId", options.programId || config.programId);
    if (options.sessionId) url.searchParams.set("sessionId", options.sessionId);
    const result = await this.request(url.toString(), {
      method: "GET",
      headers: this.authHeaders(),
    });
    this.emitStatus(result);
    return result;
  }

  async connectInstagram(options = {}) {
    return this.connectChannel("instagram", options);
  }

  async connectChannel(provider, options = {}) {
    if (provider !== "instagram") {
      throw new Error(`Boomin Connect channel "${provider}" is not supported by this SDK version.`);
    }
    const config = this.requireConfig();
    if (isBrowser()) {
      try {
        window.sessionStorage.removeItem(REDIRECT_RESULT_KEY);
      } catch {
        // Storage cleanup is best-effort in private or embedded contexts.
      }
    }
    this.emit("connect:start", { provider });

    try {
      const redirectUri = options.redirectUri || config.redirectUri || (isBrowser() ? window.location.href : undefined);
      const body = {
        publicKey: config.publicKey,
        programId: options.programId || config.programId,
        redirectUri,
        referralCode: options.referralCode,
        requireCreator: options.requireCreator,
        metadata: options.metadata || {},
      };
      const session = await this.request(`${config.apiBase}/channels/${encodeURIComponent(provider)}/start`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(removeEmpty(body)),
      });

      const sessionId = session.sessionId || session.session_id;
      const state = session.state || session.oauth_state || sessionId;
      const authUrl = session.authUrl || session.auth_url || session.url;
      if (!sessionId || !authUrl) {
        throw new Error("Boomin Connect did not return a usable Instagram auth session.");
      }

      this.lastSessionId = sessionId;
      this.emit("connect:redirect", { sessionId, state, authUrl });

      if (options.mode === "manual") {
        return { sessionId, state, authUrl };
      }

      if (!isBrowser()) {
        return { sessionId, state, authUrl };
      }

      if (options.mode === "popup") {
        const popup = window.open(authUrl, options.popupName || "boomin_connect", "width=520,height=720,noopener,noreferrer");
        if (popup) return { sessionId, state, authUrl, popup };
      }

      window.location.assign(authUrl);
      return { sessionId, state, authUrl };
    } catch (error) {
      this.emitConnectError(error);
      throw error;
    }
  }

  async getConnectStatus(sessionId) {
    const config = this.requireConfig();
    if (!sessionId) throw new Error("Boomin.getConnectStatus requires a sessionId.");
    const status = await this.request(`${config.apiBase}/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
    this.emitStatus(status);
    return status;
  }

  attachConnectButton(selectorOrElement, options = {}) {
    if (!isBrowser()) {
      throw new Error("Boomin.attachConnectButton can only run in a browser.");
    }

    const element = typeof selectorOrElement === "string"
      ? document.querySelector(selectorOrElement)
      : selectorOrElement;
    if (!element) {
      throw new Error("Boomin.attachConnectButton could not find the target element.");
    }

    const label = options.label || element.textContent || "Connect Instagram";
    const loadingLabel = options.loadingLabel || "Connecting...";
    const connectedLabel = options.connectedLabel || "Instagram connected";
    const pendingLabel = options.pendingLabel || "Pending approval";
    const errorLabel = options.errorLabel || label;

    element.textContent = label;
    element.setAttribute("data-boomin-connect", "idle");
    if (options.className) element.className = options.className;

    const setState = (state, text) => {
      element.setAttribute("data-boomin-connect", state);
      element.textContent = text;
      if ("disabled" in element) element.disabled = state === "loading";
    };

    const onClick = async (event) => {
      event.preventDefault();
      setState("loading", loadingLabel);
      try {
        await this.connectInstagram({
          referralCode: options.referralCode,
          metadata: options.metadata,
          redirectUri: options.redirectUri,
          requireCreator: options.requireCreator,
          mode: options.mode,
        });
      } catch (error) {
        setState("error", errorLabel);
        if (options.onError) options.onError(error);
      }
    };

    const unsubscribers = [
      this.on("connect:connected", () => setState("connected", connectedLabel)),
      this.on("connect:pending_approval", () => setState("pending", pendingLabel)),
      this.on("connect:approved", () => setState("connected", connectedLabel)),
      this.on("connect:error", () => setState("error", errorLabel)),
    ];

    element.addEventListener("click", onClick);

    return {
      destroy: () => {
        element.removeEventListener("click", onClick);
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      },
      element,
    };
  }

  consumeRedirectResult() {
    if (!isBrowser()) return null;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("boomin_status");
    const sessionId = url.searchParams.get("boomin_session_id");
    const error = url.searchParams.get("boomin_error");
    const errorDetail = url.searchParams.get("boomin_error_detail");
    if (!status && !error) {
      const stored = window.sessionStorage.getItem(REDIRECT_RESULT_KEY);
      return stored ? JSON.parse(stored) : null;
    }

    const result = {
      status: status || "failed",
      sessionId,
      username: url.searchParams.get("boomin_username"),
      error,
      errorDetail,
    };
    window.sessionStorage.setItem(REDIRECT_RESULT_KEY, JSON.stringify(result));

    ["boomin_status", "boomin_session_id", "boomin_username", "boomin_error", "boomin_error_detail"].forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, "", url.toString());

    if (error) {
      this.emit("connect:error", { error, errorDetail, sessionId });
    } else {
      this.emitStatus({ status: result.status, sessionId, username: result.username });
    }
    return result;
  }

  requireConfig() {
    if (!this.config || !this.ready) {
      throw new Error("Call Boomin.init before using Boomin Connect.");
    }
    return this.config;
  }

  async request(url, init) {
    const config = this.requireConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init && init.headers ? init.headers : {}),
        },
        signal: controller.signal,
        credentials: "omit",
      });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      if (!response.ok) {
        const message = data && typeof data === "object" && "message" in data
          ? data.message
          : response.statusText || "Boomin request failed.";
        const error = new Error(message);
        error.status = response.status;
        if (data && typeof data === "object") {
          error.code = data.code;
          error.response = data;
        }
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  emitStatus(status) {
    const raw = status && (status.status || status.state);
    if (!raw) return;
    if (raw === "connected") this.emit("connect:connected", status);
    if (raw === "joined" || raw === "needs_channel" || raw === "needs_instagram" || raw === "grace" || raw === "not_qualified" || raw === "qualified") {
      this.emit(`connect:${raw}`, status);
    }
    if (raw === "pending_approval") this.emit("connect:pending_approval", status);
    if (raw === "approved") this.emit("connect:approved", status);
    if (raw === "failed" || raw === "rejected") this.emit("connect:error", status);
  }

  emitConnectError(error) {
    this.emit("connect:error", {
      error,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  emit(eventName, payload) {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        setTimeout(() => { throw error; }, 0);
      }
    });
  }

  storageKey() {
    const config = this.requireConfig();
    return `${TOKEN_STORAGE_PREFIX}:${config.publicKey}`;
  }

  getStoredToken() {
    if (!isBrowser()) return null;
    try {
      return window.localStorage.getItem(this.storageKey());
    } catch {
      return null;
    }
  }

  setStoredToken(token) {
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(this.storageKey(), String(token));
    } catch {
      // Browsers can deny storage in private contexts; keep the SDK usable.
    }
  }

  clearStoredToken() {
    if (!isBrowser()) return;
    try {
      window.localStorage.removeItem(this.storageKey());
    } catch {
      // Ignore storage failures.
    }
  }

  authHeaders() {
    const token = this.getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function removeEmpty(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function publicClientConfig(config) {
  return {
    publicKey: config.publicKey,
    programId: config.programId,
    redirectUri: config.redirectUri,
    apiBase: config.apiBase,
  };
}

export const Boomin = new BoominConnectClient();
export const init = (options) => Boomin.init(options);
export const requestOtp = (options) => Boomin.requestOtp(options);
export const verifyOtp = (options) => Boomin.verifyOtp(options);
export const getCurrentCreator = () => Boomin.getCurrentCreator();
export const joinProgram = (options) => Boomin.joinProgram(options);
export const getProgramStatus = (options) => Boomin.getProgramStatus(options);
export const connectChannel = (provider, options) => Boomin.connectChannel(provider, options);
export const connectInstagram = (options) => Boomin.connectInstagram(options);
export const getConnectStatus = (sessionId) => Boomin.getConnectStatus(sessionId);
export const attachConnectButton = (selectorOrElement, options) => Boomin.attachConnectButton(selectorOrElement, options);
export const on = (eventName, handler) => Boomin.on(eventName, handler);

export default Boomin;
