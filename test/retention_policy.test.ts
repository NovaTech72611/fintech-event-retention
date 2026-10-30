import assert from "node:assert/strict";
import test from "node:test";
import { decideRetention, paymentEventSchema } from "../src/retention_policy";

test("a chargeback is retained as dispute evidence and held for review", () => {
  const event = paymentEventSchema.parse({
    eventId: "evt_chargeback_2048",
    accountId: "creator_73",
    kind: "chargeback",
    amountMinor: 12900,
    currency: "USD",
    riskScore: 91,
    occurredAt: "2026-09-30T08:00:00.000Z",
  });

  const decision = decideRetention(event, "2026-09-30T08:01:00.000Z");

  assert.equal(decision.prefix, "payment-events/disputes/");
  assert.equal(decision.retainDays, 365);
  assert.equal(decision.riskAction, "hold_and_review");
  assert.equal(decision.objectKey, "payment-events/disputes/creator_73/evt_chargeback_2048.json");
  assert.equal(decision.auditNotification.reason, "Chargeback evidence retained for dispute review");
});
