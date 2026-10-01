import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { leadTrackingFiles } from "@boomin/sdk/leads/scaffold";

test("referral CLI uses the shared SDK generator with new-account migration and auth provider", () => {
  const output = execFileSync(process.execPath, ["src/cli.js", "referral", "init", "--auth", "clerk",
    "--customer-table", "auth.users", "--customer-id-column", "user_id", "--json"], { encoding: "utf8" });
  const { files } = JSON.parse(output);
  const expected = leadTrackingFiles({ customerTable: "auth.users", customerIdColumn: "user_id" });
  assert.equal(files["boomin/lead-tracking.sql"], expected["boomin/lead-tracking.sql"]);
  assert.equal(files["app/r/[code]/route.js"], expected["app/r/[code]/route.js"]);
  assert.match(files["lib/boomin-lead-hooks.js"], /@clerk\/nextjs\/server/);
  assert.match(files["app/api/boomin/partner/status/route.js"], /getStanding/);
  assert.ok(files["app/api/boomin/leads/signup/route.js"]);
  assert.ok(files["app/api/boomin/leads/deliver/route.js"]);
});
