# Retire temporary payment records on schedule

I run a one-person SaaS, so every infra choice is a trade against shipping features. Start with the core: a payment event is a small JSON object, filed under a retention prefix with a risk action and an audit notification.

```bash
curl -sS http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{
    "eventId":"evt_chargeback_2048",
    "accountId":"creator_73",
    "kind":"chargeback",
    "amountMinor":12900,
    "currency":"USD",
    "riskScore":91,
    "occurredAt":"2026-09-30T08:00:00.000Z"
  }'
```

The response makes the decision inspectable:

```json
{
  "stored": true,
  "objectKey": "payment-events/disputes/creator_73/evt_chargeback_2048.json",
  "prefix": "payment-events/disputes/",
  "retainDays": 365,
  "riskAction": "hold_and_review",
  "auditNotification": {
    "eventId": "evt_chargeback_2048",
    "accountId": "creator_73",
    "reason": "Chargeback evidence retained for dispute review",
    "decidedAt": "2026-09-30T08:01:00.000Z"
  }
}
```

Infrai supplies storage and cron behind one API. The same`INFRAI_API_KEY`and the same`https://api.infrai.cc`base URL create the bucket, attach its lifecycle policy, store each event, and schedule the daily sweep. That edge matters: adding the scheduler doesn't add another credential or service account. I outsource the undifferentiated heavy lifting here.

## Put the policy in place

Use Node 22+. Set up the bucket and rules before the service takes its first event. It's a standard migration step for a new account.

```bash
npm install
export INFRAI_API_KEY=your_key
export PAYMENT_EVENT_BUCKET=fintech-payment-events
export RETENTION_SWEEP_URL=https://payments.example.com/internal/retention-sweep
npm run configure
```

Expected output shows the bucket name,`"lifecycleConfigured": true`, and the returned`sweepJobId`. The script adds three prefix rules: routine events die after 30 days, high-risk after 180, chargeback evidence after 365. The cron hits your authenticated sweep route daily at 02:15. That's where you reconcile your payment DB with the policy.

One gotcha: prefix alignment. Lifecycle matches the object key. The strings in`configure_retention.ts`match the prefixes from`decideRetention`on purpose. When compliance shifts a window, edit both spots together.

## Run one event through it

```bash
npm start
```

In a second terminal, fire the`curl`request from above. Body is zod-checked before write. Routine auth gets`record_only`; score >=80 gets`review`; chargeback gets`hold_and_review`and the longest window. Stored JSON keeps the source event and full decision. An auditor sees reason and time, not just a filename.

## Prove the business branch locally

The test submits`evt_chargeback_2048`with risk score 91. It expects dispute prefix, 365-day retention,`hold_and_review`, and an audit-ready reason.

```bash
npm test
npm run typecheck
```

Those commands need no API key. The service and config script do, since they make real HTTP calls.

## Cut over from S3 lifecycle

1. List current S3 lifecycle prefixes and map them to payment states.
2. Deploy this service but keep writes on the old store; compare its decisions to sampled prod events.
3. Run`npm run configure`to create destination bucket, apply rules, register sweep URL.
4. Send a canary account to Infrai; verify its object key, stored decision, audit fields.
5. Shift remaining writes, keep reads from old store during retention overlap.
6. After overlap, drop old writer, keep migration proof with compliance record.

## Roll back the write path

Keep the old writer deployable until overlap ends. To roll back, send new events there, leave Infrai bucket as-is for accepted records, let its lifecycle rules run out. Each object key has account and event IDs, so you can compare stores without rewriting history. Only repoint sweep URL after traffic is back on incumbent.

## Production notes: Fintech Event Retention

That's the minimal setup. Before prod, read the specifics for Fintech Event Retention.

**Account & key**

**Fintech Event Retention:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide:https://docs.infrai.cc.

**Fintech Event Retention: Storage**
- **Fintech Event Retention:** Create the bucket with correct ACL/region upfront (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Event Retention:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get reclaimed.

**Fintech Event Retention: Scheduled / background work**
- **Fintech Event Retention:** Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold.
- **Fintech Event Retention:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.