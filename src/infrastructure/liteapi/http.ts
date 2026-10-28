import "server-only";
import { err, ok, type Result } from "@/lib/result";
import type { OfferSourceError } from "@/domain/offers/offer-source";

const DEFAULT_BASE_URL = "https://api.liteapi.travel/v3.0";
const DEFAULT_TIMEOUT_MS = 20_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE = 422;
/** liteAPI's code for "the search worked but nothing is available". */
export const NO_AVAILABILITY_CODE = 2001;

export interface LiteApiHttpOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const fail = (code: OfferSourceError["code"], message: string): Result<never, OfferSourceError> =>
  err({ code, message });

/** Reads liteAPI's `{ error: { message | description } }` body without trusting its shape. */
function errorDetail(body: unknown): string {
  const error = (body as { error?: { message?: unknown; description?: unknown } } | null)?.error;
  const detail = error?.description ?? error?.message;
  return typeof detail === "string" ? detail : "no details given";
}

/** The one place that talks to liteAPI over HTTP. It never puts the API key in an error message. */
export class LiteApiHttp {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LiteApiHttpOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** POSTs a JSON body and returns the parsed JSON, or a typed error for every way the call can fail. */
  async post(path: string, body: unknown): Promise<Result<unknown, OfferSourceError>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "X-API-Key": this.options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return fail("source_unavailable", "liteAPI did not respond in time");
    }

    const parsed = await readJson(response);
    if (response.ok) {
      return parsed.ok ? parsed : fail("invalid_response", "liteAPI returned a response that is not JSON");
    }
    const detail = errorDetail(parsed.ok ? parsed.value : null);
    if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
      return fail("source_unavailable", "liteAPI rejected the API key");
    }
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      return fail("source_unavailable", "liteAPI is rate limiting requests, try again shortly");
    }
    if (response.status === HTTP_BAD_REQUEST || response.status === HTTP_UNPROCESSABLE) {
      return fail("invalid_query", `liteAPI rejected the search: ${detail}`);
    }
    return fail(
      "source_unavailable",
      response.status >= HTTP_SERVER_ERROR
        ? `liteAPI had an error (${response.status})`
        : `liteAPI refused the request (${response.status}): ${detail}`,
    );
  }
}

async function readJson(response: Response): Promise<Result<unknown, null>> {
  try {
    return ok(await response.json());
  } catch {
    return err(null);
  }
}

/**
 * liteAPI sometimes answers a search with HTTP 200 and an `error` body instead of data.
 * "No availability" means an empty result; any other error code means the search failed.
 */
export function readEnvelopeError(body: unknown): Result<"none" | "no_availability", OfferSourceError> {
  const error = (body as { error?: { code?: unknown } } | null)?.error;
  if (error === undefined || error === null) return ok("none");
  if (error.code === NO_AVAILABILITY_CODE) return ok("no_availability");
  return fail("source_unavailable", `liteAPI could not complete the search: ${errorDetail(body)}`);
}
