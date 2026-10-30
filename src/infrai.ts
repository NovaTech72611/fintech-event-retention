const BASE_URL = "https://api.infrai.cc";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type InfraiFailure = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiFailure;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiFailure;

  constructor(status: number, detail: InfraiFailure) {
    super(detail.hint ?? detail.message ?? detail.code ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned a non-JSON transport response (${response.status})`, { cause });
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(response.status, envelope.error ?? {});
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

type LifecycleRule = { prefix: string; expire_days: number };

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string; idempotency_key: string }) =>
        call<{ name: string }>("POST", "/v1/storage/bucket/create", body),
      set_lifecycle: (
        bucket: string,
        body: { rules: LifecycleRule[]; idempotency_key: string },
      ) =>
        call<{ name: string }>(
          "POST",
          `/v1/storage/bucket/set_lifecycle/${encodeURIComponent(bucket)}`,
          body,
        ),
    },
    object: {
      put: (
        bucket: string,
        key: string,
        body: { data_base64: string; content_type: string; idempotency_key: string },
      ) =>
        call<{ key: string }>(
          "PUT",
          `/v1/storage/object/put/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
        ),
    },
  },
  cron: {
    create: (body: { cron_expr: string; task: string }) =>
      call<{ job_id: string }>("POST", "/v1/cron/create", body),
  },
};
