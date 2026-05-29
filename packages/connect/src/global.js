(function (global) {
  "use strict";

  var DEFAULT_API_BASE = "https://api.boomin.ai/v1/connect";
  var DEFAULT_TIMEOUT_MS = 15000;
  var REDIRECT_RESULT_KEY = "boomin_connect_redirect_result";
  var TOKEN_STORAGE_PREFIX = "boomin_connect_token";

  function isBrowser() {
    return typeof window !== "undefined" && typeof document !== "undefined";
  }

  function stripTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function removeEmpty(input) {
    var output = {};
    Object.keys(input).forEach(function (key) {
      var value = input[key];
      if (value !== undefined && value !== null && value !== "") output[key] = value;
    });
    return output;
  }

  function publicClientConfig(config) {
    return {
      publicKey: config.publicKey,
      programId: config.programId,
      redirectUri: config.redirectUri,
      apiBase: config.apiBase,
    };
  }

  function BoominConnectClient() {
    this.config = null;
    this.handlers = {};
    this.lastSessionId = null;
    this.ready = false;
  }

  BoominConnectClient.prototype.init = function (options) {
    if (!options || typeof options !== "object") throw new Error("Boomin.init requires a configuration object.");
    if (!options.publicKey || typeof options.publicKey !== "string") throw new Error("Boomin.init requires a publicKey. Run `npx @boomin/cli init` to create your Boomin program config.");
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
  };

  BoominConnectClient.prototype.on = function (eventName, handler) {
    if (typeof handler !== "function") throw new Error("Boomin.on requires a handler function.");
    this.handlers[eventName] = this.handlers[eventName] || [];
    this.handlers[eventName].push(handler);
    var handlers = this.handlers[eventName];
    return function () {
      var index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    };
  };

  BoominConnectClient.prototype.off = function (eventName, handler) {
    var handlers = this.handlers[eventName] || [];
    var index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    return this;
  };

  BoominConnectClient.prototype.getConfig = function () {
    var config = this.requireConfig();
    var url = new URL(config.apiBase + "/config");
    url.searchParams.set("publicKey", config.publicKey);
    if (config.programId) url.searchParams.set("programId", config.programId);
    return this.request(url.toString(), { method: "GET" });
  };

  BoominConnectClient.prototype.requestOtp = function (options) {
    options = options || {};
    var self = this;
    var config = this.requireConfig();
    if (!options.email) throw new Error("Boomin.requestOtp requires an email.");
    return this.request(config.apiBase + "/auth/otp", {
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
    }).then(function (result) {
      self.emit("auth:otp_sent", result);
      return result;
    }).catch(function (error) {
      self.emitConnectError(error);
      throw error;
    });
  };

  BoominConnectClient.prototype.verifyOtp = function (options) {
    options = options || {};
    var self = this;
    var config = this.requireConfig();
    if (!options.email) throw new Error("Boomin.verifyOtp requires an email.");
    if (!options.code) throw new Error("Boomin.verifyOtp requires a code.");
    return this.request(config.apiBase + "/auth/verify", {
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
    }).then(function (result) {
      var token = result.auth_token || result.token;
      if (token) self.setStoredToken(token);
      self.emit("auth:verified", result);
      if (result.status === "pending" || (result.member && result.member.approval_status === "pending")) {
        self.emit("creator:pending", result);
      }
      return result;
    }).catch(function (error) {
      self.emitConnectError(error);
      throw error;
    });
  };

  BoominConnectClient.prototype.getCurrentCreator = function () {
    var self = this;
    var config = this.requireConfig();
    var url = new URL(config.apiBase + "/me");
    url.searchParams.set("publicKey", config.publicKey);
    if (config.programId) url.searchParams.set("programId", config.programId);
    return this.request(url.toString(), {
      method: "GET",
      headers: this.authHeaders(),
    }).then(function (result) {
      if (result.status === "pending" || (result.member && result.member.approval_status === "pending")) {
        self.emit("creator:pending", result);
      }
      return result;
    });
  };

  BoominConnectClient.prototype.connectInstagram = function (options) {
    return this.connectChannel("instagram", options || {});
  };

  BoominConnectClient.prototype.joinProgram = function (options) {
    options = options || {};
    var self = this;
    var config = this.requireConfig();
    return this.request(config.apiBase + "/join", {
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
    }).then(function (result) {
      self.emitStatus(result);
      return result;
    }).catch(function (error) {
      self.emitConnectError(error);
      throw error;
    });
  };

  BoominConnectClient.prototype.getProgramStatus = function (options) {
    options = options || {};
    var self = this;
    var config = this.requireConfig();
    var url = new URL(config.apiBase + "/status");
    url.searchParams.set("publicKey", config.publicKey);
    if (options.programId || config.programId) url.searchParams.set("programId", options.programId || config.programId);
    if (options.sessionId) url.searchParams.set("sessionId", options.sessionId);
    return this.request(url.toString(), {
      method: "GET",
      headers: this.authHeaders(),
    }).then(function (result) {
      self.emitStatus(result);
      return result;
    });
  };

  BoominConnectClient.prototype.connectChannel = function (provider, options) {
    options = options || {};
    if (provider !== "instagram") throw new Error("Boomin Connect channel \"" + provider + "\" is not supported by this SDK version.");
    var self = this;
    var config = this.requireConfig();
    if (isBrowser()) {
      try {
        window.sessionStorage.removeItem(REDIRECT_RESULT_KEY);
      } catch (error) {
        // Storage cleanup is best-effort in private or embedded contexts.
      }
    }
    this.emit("connect:start", { provider: provider });
    var redirectUri = options.redirectUri || config.redirectUri || (isBrowser() ? window.location.href : undefined);
    var body = removeEmpty({
      publicKey: config.publicKey,
      programId: options.programId || config.programId,
      redirectUri: redirectUri,
      referralCode: options.referralCode,
      requireCreator: options.requireCreator,
      metadata: options.metadata || {},
    });
    return this.request(config.apiBase + "/channels/" + encodeURIComponent(provider) + "/start", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    }).then(function (session) {
      var sessionId = session.sessionId || session.session_id;
      var state = session.state || session.oauth_state || sessionId;
      var authUrl = session.authUrl || session.auth_url || session.url;
      if (!sessionId || !authUrl) throw new Error("Boomin Connect did not return a usable Instagram auth session.");
      self.lastSessionId = sessionId;
      self.emit("connect:redirect", { sessionId: sessionId, state: state, authUrl: authUrl });
      if (options.mode === "manual" || !isBrowser()) return { sessionId: sessionId, state: state, authUrl: authUrl };
      if (options.mode === "popup") {
        var popup = window.open(authUrl, options.popupName || "boomin_connect", "width=520,height=720,noopener,noreferrer");
        if (popup) return { sessionId: sessionId, state: state, authUrl: authUrl, popup: popup };
      }
      window.location.assign(authUrl);
      return { sessionId: sessionId, state: state, authUrl: authUrl };
    }).catch(function (error) {
      self.emitConnectError(error);
      throw error;
    });
  };

  BoominConnectClient.prototype.getConnectStatus = function (sessionId) {
    var self = this;
    var config = this.requireConfig();
    if (!sessionId) throw new Error("Boomin.getConnectStatus requires a sessionId.");
    return this.request(config.apiBase + "/sessions/" + encodeURIComponent(sessionId), { method: "GET" })
      .then(function (status) {
        self.emitStatus(status);
        return status;
      });
  };

  BoominConnectClient.prototype.attachConnectButton = function (selectorOrElement, options) {
    options = options || {};
    if (!isBrowser()) throw new Error("Boomin.attachConnectButton can only run in a browser.");
    var element = typeof selectorOrElement === "string" ? document.querySelector(selectorOrElement) : selectorOrElement;
    if (!element) throw new Error("Boomin.attachConnectButton could not find the target element.");
    var label = options.label || element.textContent || "Connect Instagram";
    var loadingLabel = options.loadingLabel || "Connecting...";
    var connectedLabel = options.connectedLabel || "Instagram connected";
    var pendingLabel = options.pendingLabel || "Pending approval";
    var errorLabel = options.errorLabel || label;
    element.textContent = label;
    element.setAttribute("data-boomin-connect", "idle");
    if (options.className) element.className = options.className;
    var setState = function (state, text) {
      element.setAttribute("data-boomin-connect", state);
      element.textContent = text;
      if ("disabled" in element) element.disabled = state === "loading";
    };
    var self = this;
    var onClick = function (event) {
      event.preventDefault();
      setState("loading", loadingLabel);
      self.connectInstagram({
        referralCode: options.referralCode,
        metadata: options.metadata,
        redirectUri: options.redirectUri,
        requireCreator: options.requireCreator,
        mode: options.mode,
      }).catch(function (error) {
        setState("error", errorLabel);
        if (options.onError) options.onError(error);
      });
    };
    var unsubscribers = [
      this.on("connect:connected", function () { setState("connected", connectedLabel); }),
      this.on("connect:pending_approval", function () { setState("pending", pendingLabel); }),
      this.on("connect:approved", function () { setState("connected", connectedLabel); }),
      this.on("connect:error", function () { setState("error", errorLabel); }),
    ];
    element.addEventListener("click", onClick);
    return {
      element: element,
      destroy: function () {
        element.removeEventListener("click", onClick);
        unsubscribers.forEach(function (unsubscribe) { unsubscribe(); });
      },
    };
  };

  BoominConnectClient.prototype.consumeRedirectResult = function () {
    if (!isBrowser()) return null;
    var url = new URL(window.location.href);
    var status = url.searchParams.get("boomin_status");
    var sessionId = url.searchParams.get("boomin_session_id");
    var error = url.searchParams.get("boomin_error");
    var errorDetail = url.searchParams.get("boomin_error_detail");
    if (!status && !error) {
      var stored = window.sessionStorage.getItem(REDIRECT_RESULT_KEY);
      return stored ? JSON.parse(stored) : null;
    }
    var result = {
      status: status || "failed",
      sessionId: sessionId,
      username: url.searchParams.get("boomin_username"),
      error: error,
      errorDetail: errorDetail,
    };
    window.sessionStorage.setItem(REDIRECT_RESULT_KEY, JSON.stringify(result));
    ["boomin_status", "boomin_session_id", "boomin_username", "boomin_error", "boomin_error_detail"].forEach(function (key) {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, "", url.toString());
    if (error) this.emit("connect:error", { error: error, errorDetail: errorDetail, sessionId: sessionId });
    else this.emitStatus({ status: result.status, sessionId: sessionId, username: result.username });
    return result;
  };

  BoominConnectClient.prototype.requireConfig = function () {
    if (!this.config || !this.ready) throw new Error("Call Boomin.init before using Boomin Connect.");
    return this.config;
  };

  BoominConnectClient.prototype.request = function (url, init) {
    var config = this.requireConfig();
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, config.timeoutMs);
    return fetch(url, {
      method: init.method,
      headers: Object.assign({ "Content-Type": "application/json" }, init.headers || {}),
      body: init.body,
      signal: controller.signal,
      credentials: "omit",
    }).then(function (response) {
      var contentType = response.headers.get("content-type") || "";
      var parse = contentType.indexOf("application/json") >= 0 ? response.json() : response.text();
      return parse.then(function (data) {
        if (!response.ok) {
          var message = data && typeof data === "object" && data.message ? data.message : response.statusText || "Boomin request failed.";
          var error = new Error(message);
          error.status = response.status;
          if (data && typeof data === "object") {
            error.code = data.code;
            error.response = data;
          }
          throw error;
        }
        return data;
      });
    }).finally(function () {
      clearTimeout(timeout);
    });
  };

  BoominConnectClient.prototype.emitStatus = function (status) {
    var raw = status && (status.status || status.state);
    if (!raw) return;
    if (raw === "connected") this.emit("connect:connected", status);
    if (raw === "joined" || raw === "needs_channel" || raw === "needs_instagram" || raw === "grace" || raw === "not_qualified" || raw === "qualified") this.emit("connect:" + raw, status);
    if (raw === "pending_approval") this.emit("connect:pending_approval", status);
    if (raw === "approved") this.emit("connect:approved", status);
    if (raw === "failed" || raw === "rejected") this.emit("connect:error", status);
  };

  BoominConnectClient.prototype.emitConnectError = function (error) {
    this.emit("connect:error", {
      error: error,
      message: error && error.message ? error.message : String(error),
    });
  };

  BoominConnectClient.prototype.emit = function (eventName, payload) {
    var handlers = this.handlers[eventName] || [];
    handlers.slice().forEach(function (handler) {
      try {
        handler(payload);
      } catch (error) {
        setTimeout(function () { throw error; }, 0);
      }
    });
  };

  BoominConnectClient.prototype.storageKey = function () {
    var config = this.requireConfig();
    return TOKEN_STORAGE_PREFIX + ":" + config.publicKey;
  };

  BoominConnectClient.prototype.getStoredToken = function () {
    if (!isBrowser()) return null;
    try {
      return window.localStorage.getItem(this.storageKey());
    } catch (error) {
      return null;
    }
  };

  BoominConnectClient.prototype.setStoredToken = function (token) {
    if (!isBrowser()) return;
    try {
      window.localStorage.setItem(this.storageKey(), String(token));
    } catch (error) {
      // Browsers can deny storage in private contexts; keep the SDK usable.
    }
  };

  BoominConnectClient.prototype.clearStoredToken = function () {
    if (!isBrowser()) return;
    try {
      window.localStorage.removeItem(this.storageKey());
    } catch (error) {
      // Ignore storage failures.
    }
  };

  BoominConnectClient.prototype.authHeaders = function () {
    var token = this.getStoredToken();
    return token ? { Authorization: "Bearer " + token } : {};
  };

  var client = new BoominConnectClient();
  global.Boomin = client;
  global.boominConnect = client;
})(typeof window !== "undefined" ? window : globalThis);
