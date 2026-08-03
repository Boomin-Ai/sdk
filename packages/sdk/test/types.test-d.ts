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
  ConflictingParametersError,
  InvalidRequestError,
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
    { name: "Spring launch", objective: "acquisition", programs: ["prog_1"], spec: { enrollment_policy: "all_approved" } },
    { idempotencyKey: "create-1", brand: "brand_2" },
  );
  // launch resolves id STRINGS; wait() takes the string OR an operation object.
  const launch: DistributionLaunchResult = await boomin.distributions.launch(distribution.id);
  const _launchedId: string = launch.operation;
  const settled: Operation = await boomin.operations.wait(launch.operation, { timeout: 1000, pollInterval: 50 });
  const _resettled: Operation = await boomin.operations.wait(settled, { timeout: 1000 });
  const _status: "pending" | "running" | "waiting" | "succeeded" | "partial" | "failed" | "canceled" = settled.status;

  const enrollment: Enrollment = await boomin.enrollments.create({ program: "prog_1", email: "a@b.c" });
  const _approval: "pending" | "approved" | "rejected" = enrollment.approvalStatus;
  const partnership: Partnership = await boomin.partnerships.resume("ptn_1");
  const _pstatus: "pending" | "active" | "paused" | "ended" = partnership.status;

  // pagination: page envelope + async iteration
  const page: List<Enrollment> = await boomin.enrollments.list({ program: "prog_1", limit: 10 });
  const _hasMore: boolean = page.hasMore;
  for await (const item of boomin.events.list({ type: "distribution.live", startingAfter: "evt_1" })) {
    const _event: BoominEvent = item;
  }

  // nested clients
  await boomin.programs.requirements.create("prog_1", { scope: "program_entry", metricKey: "referral_count" });
  await boomin.programs.connectConfig.update("prog_1", { allowedOrigins: ["https://example.com"] });
  await boomin.performance.events.create({ deployment: "dep_1", type: "sale", valueMinor: 100, externalEventId: "order_1" });
  const endpoint = await boomin.webhooks.endpoints.create({ url: "https://x.com/wh", enabledEvents: ["payout.settled"] });
  const _secret: string | undefined = endpoint.secret;
  const _events: string[] | undefined = endpoint.enabledEvents;
  const run = await boomin.payouts.run({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  // Branch on `outcome`, never on a count — the two used to be one number.
  const _outcome: string = run.outcome;
  const _evaluated: number = run.rulesEvaluated;
  const _totalMinor: number = run.summary.totalAmountMinor;
  await boomin.payouts.batches.retrieve("pb_1");

  // Payout configuration nests under `payouts` — there is no root client.
  const rule = await boomin.payouts.rules.create({
    name: "Registration CPA",
    type: "cpa",
    scope: { type: "program", program: "prog_1" },
    metricKey: "event_registration",
    perUnitMinor: 500,
  });
  const _perUnit: number | null | undefined = rule.perUnitMinor;
  const _scopeProgram: string = rule.scope.program;
  await boomin.payouts.rules.archive(rule.id);
  const rail = await boomin.payouts.rails.create({
    rail: "csv_batch",
    isDefault: true,
    config: {
      format: "paypal_payouts_csv",
      walletFunded: false,
      // The customer's own headers, in the customer's own casing.
      columns: [{ key: "email", header: "Email Address" }],
    },
  });
  const _header: string | undefined = rail.config.columns?.[0].header;
  const _walletFunded: boolean | undefined = rail.config.walletFunded;
  const accepted = await boomin.payouts.batches.export("pb_1");
  // id STRINGS, not objects.
  const _op: string = accepted.operation;
  const _batchRef: string = accepted.batch;
  await boomin.payouts.batches.confirm("pb_1", {
    externalBatchRef: "PAYPAL-2026-08",
    results: [{ item: "pbi_1", status: "paid" }],
  });
  void [_outcome, _evaluated, _totalMinor, _perUnit, _scopeProgram, _header, _walletFunded, _op, _batchRef];

  // responses are camelCase all the way down
  const _receivedAt: string | undefined = (
    await boomin.performance.events.create({ deployment: "dep_1", type: "sale", valueMinor: 1 })
  ).receivedAt;
  const _planHash: string | null | undefined = distribution.planHash;
  const _waiting: string | null | undefined = settled.waitingReason;
  const _createdAt: string | undefined = enrollment.createdAt;
  // exportCsv is a 202 of id strings; the URL lives on the batch, re-minted on
  // every read, so it can never be handed back already expiring.
  const _exportBatch: string = (await boomin.payouts.exportCsv({})).batch;
  const _batchUrl: string | null | undefined = (await boomin.payouts.batches.retrieve("pb_1")).downloadUrl;
  // …except inside customer-owned blobs, whose keys round-trip verbatim.
  const _specKey: unknown = distribution.spec?.enrollment_policy;
  void [_receivedAt, _planHash, _waiting, _createdAt, _exportBatch, _batchUrl, _specKey];

  // raw escape hatch: same client, wire-shaped objects
  const rawClient = new Boomin("sk_live_x", { rawResponses: true });
  void rawClient;

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
    } else if (err instanceof ConflictingParametersError) {
      // Client-side, pre-flight: both spellings of one field were supplied.
      const _conflict: string | null = err.conflictsWith;
      const _isInvalidRequest: InvalidRequestError = err;
      void [_conflict, _isInvalidRequest];
    } else if (err instanceof BoominError) {
      void err.param;
    }
  }

  // @ts-expect-error secretKey is required
  new Boomin();
  // @ts-expect-error enrollments.create requires a program
  await boomin.enrollments.create({ email: "a@b.c" });
  // @ts-expect-error distributions.create requires a name
  await boomin.distributions.create({ objective: "acquisition" });
  // @ts-expect-error payouts.run requires both period bounds
  await boomin.payouts.run({ periodStart: "2026-08-01" });
  // @ts-expect-error retrieve takes a string id
  await boomin.partners.retrieve(42);
}

void exercise;
