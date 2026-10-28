import "server-only";
import { err, ok, type Result } from "@/lib/result";
import type { SupplierError } from "@/domain/booking/ports";

const HOTEL_BOOKING_URL = "https://book.liteapi.travel/v3.0";
const FLIGHT_BOOKING_URL = "https://api.liteapi.travel/v3.0";
/** Booking waits on the airline or hotel, so it gets longer than a search. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface LiteApiBookingHttpOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** What liteAPI answered, whatever the HTTP status. */
export interface LiteApiReply {
  readonly status: number;
  readonly body: unknown;
}

export type BookingHost = "hotels" | "flights";

/** liteAPI's own error numbers that say more than the HTTP status does. */
const GONE_CODES = new Set([4012, 4040, 42004, 42017, 45029, 45063, 45084, 46002]);
const PRICE_CODES = new Set([52020, 52021]);
/** The same request again is refused; it will not work by trying once more. */
const REFUSED_CODES = new Set([4005, 4002, 43002]);

function errorCodeOf(body: unknown): number | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "number" ? code : null;
}

function errorTextOf(body: unknown): string {
  const error = (body as { error?: { description?: unknown; message?: unknown } } | null)?.error;
  const text = error?.description ?? error?.message;
  return typeof text === "string" ? text.slice(0, 120) : "no details given";
}

/** Turns a failed reply into one of the few things the booking runner acts on. The text is for logs only. */
export function classifyFailure(reply: LiteApiReply): SupplierError {
  const code = errorCodeOf(reply.body);
  const message = `liteAPI answered ${reply.status}${code === null ? "" : ` (${code})`}: ${errorTextOf(reply.body)}`;
  if (code !== null && PRICE_CODES.has(code)) return { code: "price_changed", message };
  // The hotel side words it in text: the price it would cost now is above the one it quoted, which is the same news.
  if ((reply.status === 409 || code === 2001) && /price/i.test(errorTextOf(reply.body))) return { code: "price_changed", message };
  if (code !== null && GONE_CODES.has(code)) return { code: "unavailable", message };
  if (code !== null && REFUSED_CODES.has(code)) return { code: "rejected", message };
  if (reply.status === 404 || reply.status === 410) return { code: "unavailable", message };
  if (reply.status === 400 || reply.status === 401 || reply.status === 403 || reply.status === 422) return { code: "rejected", message };
  // 408, 409, 429 and 5xx: nothing was settled, so it is treated as a temporary problem.
  return { code: "temporary", message };
}

export const succeeded = (reply: LiteApiReply): boolean => reply.status >= 200 && reply.status < 300;

/**
 * Sends the booking calls to liteAPI. Hotels are booked on one host and flights on another. It never puts the
 * API key in an error, and it hands back the reply whatever its status, because for bookings the status matters
 * (a 202 on a flight cancellation means "still being cancelled").
 */
export class LiteApiBookingHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: LiteApiBookingHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(host: BookingHost, method: "POST" | "PUT", path: string, body?: unknown): Promise<Result<LiteApiReply, SupplierError>> {
    const base = host === "hotels" ? HOTEL_BOOKING_URL : FLIGHT_BOOKING_URL;
    let response: Response;
    try {
      response = await this.fetchImpl(`${base}${path}`, {
        method,
        headers: { "X-API-Key": this.options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return err({ code: "temporary", message: "liteAPI did not respond in time" });
    }
    try {
      return ok({ status: response.status, body: await response.json() });
    } catch {
      return ok({ status: response.status, body: null });
    }
  }
}
