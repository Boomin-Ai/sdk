// @boomin/components — the runtime door.
//
// The bundles are DELIVERED AT RUNTIME from Boomin (a fix reaches every host
// without a release): this module injects the runtime script once and
// delegates to `window.Boomin.components`. The same artifacts ship in this
// package's dist/ for hosts that must self-serve (air-gapped, CSP-locked).
const DEFAULT_BASE = "https://boomin.ai";
const CONTRACT = 1;

let runtimePromise = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

/** Load the runtime (`/components/v1.js`) from `base` once. Resolves to
 *  `window.Boomin.components`. */
export function loadRuntime(options = {}) {
  if (!isBrowser()) return Promise.reject(new Error("@boomin/components runs in a browser."));
  const existing = window.Boomin && window.Boomin.components;
  if (existing) return Promise.resolve(existing);
  if (runtimePromise) return runtimePromise;
  const base = stripTrailingSlash(options.base || DEFAULT_BASE);
  runtimePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}/components/v1.js`;
    script.async = true;
    script.onload = () => {
      const runtime = window.Boomin && window.Boomin.components;
      if (!runtime) return reject(new Error("@boomin/components: the runtime loaded but exposed no Boomin.components."));
      if (runtime.contract !== CONTRACT) {
        return reject(new Error(`@boomin/components: runtime contract ${runtime.contract} does not match this package (${CONTRACT}). Update @boomin/components.`));
      }
      resolve(runtime);
    };
    script.onerror = () => {
      runtimePromise = null;
      reject(new Error(`@boomin/components: failed to load ${script.src}`));
    };
    document.head.appendChild(script);
  });
  return runtimePromise;
}

/** Mount a named component into `el`. See `@boomin/components/console`. */
export function mount(name, el, options = {}) {
  const { base, ...rest } = options;
  return loadRuntime({ base }).then((runtime) => runtime.mount(name, el, rest));
}

export { CONTRACT };
export default { mount, loadRuntime, CONTRACT };
