// @boomin/components/console — the org-admin Brand Settings console.
//
//   import { mountConsole } from "@boomin/components/console";
//   const handle = await mountConsole(el, { handoff, brand: "acme", section: "payments" });
//
// `handoff` is a one-time code. Inside the Producer desktop app it comes from
// the app's own session; in your product it comes from your backend via
// `@boomin/sdk`: `boomin.consoleSessions.create({ email })`.
import { mount } from "./index.js";

export function mountConsole(el, options) {
  return mount("console", el, options);
}

export default mountConsole;
