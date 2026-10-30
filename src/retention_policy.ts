import { z } from "zod";

export const paymentEventSchema = z.object({
  eventId: z.string().min(1).max(120),
  accountId: z.string().min(1).max(120),
  kind: z.enum(["authorization", "settlement", "refund", "chargeback"]),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  riskScore: z.number().min(0).max(100),
  occurredAt: z.string().datetime(),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type RiskAction = "record_only" | "review" | "hold_and_review";

export type RetentionDecision = {
  objectKey: string;
  prefix: "payment-events/standard/" | "payment-events/review/" | "payment-events/disputes/";
  retainDays: 30 | 180 | 365;
  riskAction: RiskAction;
  auditNotification: {
    eventId: string;
    accountId: string;
    reason: string;
    decidedAt: string;
  };
};

export function decideRetention(event: PaymentEvent, decidedAt = new Date().toISOString()): RetentionDecision {
  const disputed = event.kind === "chargeback";
  const highRisk = event.riskScore >= 80;
  const prefix = disputed
    ? "payment-events/disputes/"
    : highRisk
      ? "payment-events/review/"
      : "payment-events/standard/";
  const retainDays = disputed ? 365 : highRisk ? 180 : 30;
  const riskAction: RiskAction = disputed ? "hold_and_review" : highRisk ? "review" : "record_only";
  const reason = disputed
    ? "Chargeback evidence retained for dispute review"
    : highRisk
      ? "Elevated risk score requires analyst review"
      : "Routine payment event follows short retention";

  return {
    objectKey: `${prefix}${event.accountId}/${event.eventId}.json`,
    prefix,
    retainDays,
    riskAction,
    auditNotification: {
      eventId: event.eventId,
      accountId: event.accountId,
      reason,
      decidedAt,
    },
  };
}
