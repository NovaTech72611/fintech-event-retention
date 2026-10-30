import { createServer, type ServerResponse } from "node:http";
import { infrai, InfraiError } from "./infrai";
import { decideRetention, paymentEventSchema } from "./retention_policy";

const bucket = process.env.PAYMENT_EVENT_BUCKET ?? "fintech-payment-events";
const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new RequestError(413, "Request body is too large");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Request body must be valid JSON");
  }
}

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payment-events") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const parsed = paymentEventSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      json(response, 400, { error: "Invalid payment event", issues: parsed.error.issues });
      return;
    }

    const decision = decideRetention(parsed.data);
    const record = { paymentEvent: parsed.data, decision };
    await infrai.storage.object.put(bucket, decision.objectKey, {
      data_base64: Buffer.from(JSON.stringify(record)).toString("base64"),
      content_type: "application/json",
      idempotency_key: `payment-event-${parsed.data.eventId}`,
    });
    json(response, 201, { stored: true, ...decision });
  } catch (error) {
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: error.message, code: error.detail.code });
      return;
    }
    console.error(error);
    json(response, 502, { error: "Storage request could not be completed" });
  }
});

server.listen(port, () => {
  console.log(`Payment retention service listening on http://localhost:${port}`);
});
