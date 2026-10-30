import { z } from "zod";
import { infrai } from "./infrai";

const configSchema = z.object({
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  sweepUrl: z.string().url(),
});

async function configure(): Promise<void> {
  const config = configSchema.parse({
    bucket: process.env.PAYMENT_EVENT_BUCKET ?? "fintech-payment-events",
    sweepUrl: process.env.RETENTION_SWEEP_URL,
  });

  await infrai.storage.bucket.create({
    name: config.bucket,
    idempotency_key: `create-${config.bucket}`,
  });
  await infrai.storage.bucket.set_lifecycle(config.bucket, {
    rules: [
      { prefix: "payment-events/standard/", expire_days: 30 },
      { prefix: "payment-events/review/", expire_days: 180 },
      { prefix: "payment-events/disputes/", expire_days: 365 },
    ],
    idempotency_key: `payment-retention-v1-${config.bucket}`,
  });
  const schedule = await infrai.cron.create({
    cron_expr: "15 2 * * *",
    task: config.sweepUrl,
  });

  console.log(JSON.stringify({
    bucket: config.bucket,
    lifecycleConfigured: true,
    sweepJobId: schedule.job_id,
  }, null, 2));
}

await configure();
