/** Browser-only first-touch referral capture. No credentials or network calls. */
export function normalizeReferralCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.trim()) ? value.trim() : null;
}

export function createAttribution(options = {}) {
  const windowDays = options.windowDays ?? 30;
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new Error("windowDays must be positive.");
  const key = options.storageKey || "boomin_attribution";
  const param = options.referralParam || "ref";
  const now = options.now || Date.now;
  let memory = null;
  const browser = () => options.window ?? (typeof window !== "undefined" ? window : null);

  function clear() {
    memory = null;
    try { browser()?.localStorage.removeItem(key); } catch { /* Browser privacy settings. */ }
  }

  function get() {
    const win = browser();
    if (!win) return null;
    let value = memory;
    try {
      const stored = win.localStorage.getItem(key);
      if (stored) value = JSON.parse(stored);
    } catch { /* In-memory capture remains usable during SPA navigation. */ }
    if (!value || !normalizeReferralCode(value.referralCode) || !Number.isFinite(value.expiresAt) || now() >= value.expiresAt) {
      clear();
      return null;
    }
    memory = value;
    return { ...value };
  }

  function capture() {
    const win = browser();
    if (!win) return null;
    const url = new URL(win.location.href);
    const code = normalizeReferralCode(url.searchParams.get(param));
    if (!code) return get();
    let value = get();
    if (!value) {
      value = { referralCode: code, capturedAt: now(), expiresAt: now() + windowDays * 86400000 };
      memory = value;
    }
    try {
      win.localStorage.setItem(key, JSON.stringify(value));
      if (options.cleanUrl !== false) {
        url.searchParams.delete(param);
        win.history.replaceState(win.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch { /* Keep the referral URL if it could not be persisted. */ }
    return { ...value };
  }

  return { capture, get, clear };
}
