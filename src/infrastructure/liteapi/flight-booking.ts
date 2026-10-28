import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { toMinorUnits } from "@/domain/money/currency";
import type { BookingTraveller, CancelOutcome, FlightBookingRequest, FlightSupplier, SupplierError, SupplierReceipt } from "@/domain/booking/ports";
import { classifyFailure, succeeded, type LiteApiBookingHttp } from "./booking-http";

const ADULT = 0;
const CANCEL_PENDING_STATUS = 202;
const ALREADY_CANCELLED_CODE = 46004;
const CANCEL_IN_PROGRESS_CODE = 46005;

const price = z.object({ total: z.number(), currency: z.string() });

const verifySchema = z.object({
  data: z.array(
    z.object({
      journey: z.object({ pricing: z.object({ display: price }) }),
      changes: z.object({ priceChanged: z.boolean().optional() }).nullish(),
    }),
  ).min(1),
});

const prebookSchema = z.object({ data: z.array(z.object({ prebookId: z.string().min(1), price: z.number(), currency: z.string() })).min(1) });

const bookSchema = z.object({
  data: z.array(z.object({ booking: z.object({ bookingId: z.string().min(1), bookingRef: z.string().nullish(), status: z.string() }) })).min(1),
});

const bad = (message: string): Result<never, SupplierError> => err({ code: "rejected", message });

function passengerOf({ details }: BookingTraveller): Record<string, unknown> {
  return {
    passengerType: ADULT,
    firstName: details.firstName,
    lastName: details.lastName,
    birthday: details.birthday,
    gender: details.gender,
    nationality: details.nationality,
    // International flights need a passport for everyone; liteAPI refuses the prebook if it is missing.
    ...(details.passport && {
      documentType: "passport",
      documentNumber: details.passport.number,
      documentIssueCountry: details.passport.issueCountry,
      documentExpiry: details.passport.expiry,
    }),
  };
}

/** Whether a total quoted in major units is within the most we may pay, in minor units. */
function withinLimit(total: number, currency: string, request: FlightBookingRequest): Result<void, SupplierError> {
  const minor = toMinorUnits(total, currency);
  if (minor === null || currency.toUpperCase() !== request.offer.currency) return bad("liteAPI's price could not be read");
  return minor > request.maxTotalMinor ? err({ code: "price_changed", message: "The flight now costs more than the offer said" }) : ok(undefined);
}

/**
 * Books flights through liteAPI, paying with its sandbox account credit, so no real money moves. It checks the
 * fare is still there and still the same price before it reserves anything, and again after.
 */
export class LiteApiFlightSupplier implements FlightSupplier {
  constructor(private readonly http: LiteApiBookingHttp) {}

  async book(request: FlightBookingRequest): Promise<Result<SupplierReceipt, SupplierError>> {
    const verified = await this.http.send("flights", "POST", "/flights/verify", { offerId: request.offer.id });
    if (!verified.ok) return verified;
    if (!succeeded(verified.value)) return err(classifyFailure(verified.value));
    const verify = verifySchema.safeParse(verified.value.body);
    if (!verify.success) return bad("liteAPI's verify answer was not in the expected shape");
    const [checked] = verify.data.data;
    const display = checked.journey.pricing.display;
    const verifiedPrice = withinLimit(display.total, display.currency, request);
    if (!verifiedPrice.ok) return verifiedPrice;
    if (checked.changes?.priceChanged) return err({ code: "price_changed", message: "The fare's price changed" });

    const lead = request.passengers[0];
    if (!lead) return bad("A flight has nobody to book it for");
    const prebooked = await this.http.send("flights", "POST", "/flights/prebooks", {
      offerId: request.offer.id,
      usePaymentSdk: false,
      contact: {
        firstName: lead.details.firstName,
        lastName: lead.details.lastName,
        email: lead.details.email,
        phoneCountryCode: lead.details.phoneCountryCode,
        phoneNumber: lead.details.phoneNumber,
      },
      passengers: request.passengers.map(passengerOf),
    });
    if (!prebooked.ok) return prebooked;
    if (!succeeded(prebooked.value)) return err(classifyFailure(prebooked.value));
    const prebook = prebookSchema.safeParse(prebooked.value.body);
    if (!prebook.success) return bad("liteAPI's prebook answer was not in the expected shape");
    const [reserved] = prebook.data.data;
    const reservedPrice = withinLimit(reserved.price, reserved.currency, request);
    if (!reservedPrice.ok) return reservedPrice;

    // Asking again with the same prebook returns the same booking, so a repeat can never book twice.
    const booked = await this.http.send("flights", "POST", "/flights/bookings", { prebookId: reserved.prebookId, payment: { method: "ACC_CREDIT_CARD" } });
    if (!booked.ok) return booked;
    if (!succeeded(booked.value)) return err(classifyFailure(booked.value));
    const booking = bookSchema.safeParse(booked.value.body);
    if (!booking.success) return bad("liteAPI's booking answer was not in the expected shape");
    const made = booking.data.data[0].booking;

    // The airline may take a moment to confirm, which counts as booked. Anything else is undone.
    if (made.status !== "CONFIRMED" && made.status !== "PENDING_CONFIRMATION") {
      await this.cancel(made.bookingId);
      return bad(`The flight was not confirmed (${made.status})`);
    }
    return ok({ bookingId: made.bookingId, confirmation: made.bookingRef ?? null });
  }

  async cancel(bookingId: string): Promise<Result<CancelOutcome, SupplierError>> {
    const cancelled = await this.http.send("flights", "POST", `/flights/bookings/${encodeURIComponent(bookingId)}/cancellations`);
    if (!cancelled.ok) return cancelled;
    if (cancelled.value.status === CANCEL_PENDING_STATUS) return ok("pending");
    if (succeeded(cancelled.value)) return ok("cancelled");

    const code = (cancelled.value.body as { error?: { code?: unknown } } | null)?.error?.code;
    // Already cancelled is the goal reached; a cancellation under way elsewhere is still pending.
    if (code === ALREADY_CANCELLED_CODE) return ok("cancelled");
    if (code === CANCEL_IN_PROGRESS_CODE) return ok("pending");
    return err(classifyFailure(cancelled.value));
  }
}
