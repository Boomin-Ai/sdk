/**
 * Compile-only exercise of the public type surface (npm run typecheck).
 * Never executed — it exists so `tsc` validates the hand-written .d.ts.
 */

import Boomin, {
  type Distribution,
  type DistributionLaunchResult,
  type Enrollment,
  type List,
  type Operation,
  type Partnership,
  type BoominEvent,
  constructEvent,
} from "../src/index.js";
import { constructEvent as constructEventSubpath } from "../src/webhooks.js";
import {
  BoominError,
  OperationConflictError,
  FundingRequiredError,
  type BoominErrorCode,
} from "../src/errors.js";

async function exercise(): Promise<void> {
  const boomin = new Boomin("sk_live_x", {
    baseUrl: "https://api.boomin.ai",
    brand: "brand_1",
    maxRetries: 1,
    timeout: 5000,
  });

  // resource clients + envelopes
  const distribution: Distribution = await boomin.distributions.create(
    { objective: "acquisition", programs: ["prog_1"], spec: { enrollment_policy: "all_approved" } },
    { idempotencyKey: "create-1", brand: "brand_2" },
  );
  const launch: DistributionLaunchResult = await boomin.distributions.launch(distribution.id, { dryRun: true });
  const settled: Operation = await boomin.operations.wait(launch.operation.id, { timeout: 1000, pollInterval: 50 });
  const _status: "pending" | "running" | "waiting" | "succeeded" | "partial" | "failed" | "canceled" = settled.status;

  const enrollment: Enrollment = await boomin.enrollments.create({ program: "prog_1", email: "a@b.c" });
  const _approval: "pending" | "approved" | "rejected" = enrollment.approval_status;
  const partnership: Partnership = await boomin.partnerships.resume("ptn_1");
  const _pstatus: "pending" | "active" | "paused" | "ended" = partnership.status;

  // pagination: page envelope + async iteration
  const page: List<Enrollment> = await boomin.enrollments.list({ program: "prog_1", limit: 10 });
  const _hasMore: boolean = page.has_more;
  for await (const item of boomin.events.list({ type: "distribution.live", startingAfter: "evt_1" })) {
    const _event: BoominEvent = item;
  }

  // nested clients
  await boomin.programs.requirements.create("prog_1", { kind: "min_followers" });
  await boomin.programs.connectConfig.update("prog_1", { theme: "dark" });
  await boomin.performance.events.create({ deployment: "dep_1", type: "conversion", value: 100 });
  await boomin.webhooks.endpoints.create({ url: "https://x.com/wh", enabledEvents: ["payout.settled"] });
  await boomin.payouts.batches.retrieve("pb_1");

  // static + subpath webhook verify are both async
  const evt: BoominEvent = await Boomin.webhooks.constructEvent("{}", "t=1,v1=a", "whsec_1", { tolerance: 300 });
  const evt2: BoominEvent = await constructEvent("{}", "t=1,v1=a", ["whsec_1", "whsec_2"]);
  const evt3: BoominEvent = await constructEventSubpath(new Uint8Array(), "t=1,v1=a", "whsec_1");
  void [evt, evt2, evt3];

  // errors
  try {
    await boomin.distributions.launch("dist_1");
  } catch (err) {
    if (err instanceof OperationConflictError) {
      const _code: BoominErrorCode | null = err.code;
      const _requestId: string | null = err.requestId;
    } else if (err instanceof FundingRequiredError) {
      const _status2: number | null = err.status;
    } else if (err instanceof BoominError) {
      void err.param;
    }
  }

  // @ts-expect-error secretKey is required
  new Boomin();
  // @ts-expect-error enrollments.create requires a program
  await boomin.enrollments.create({ email: "a@b.c" });
  // @ts-expect-error distributions.create requires an objective
  await boomin.distributions.create({ name: "missing objective" });
  // @ts-expect-error retrieve takes a string id
  await boomin.partners.retrieve(42);
}

void exercise;
