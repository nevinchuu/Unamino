import { createHash } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { toMinorUnits } from "@/domain/money/currency";
import type { FailureCause } from "@/domain/booking/failure";
import type { BookingTraveller, CancelOutcome, HotelBookingRequest, HotelSupplier, SupplierError, SupplierReceipt } from "@/domain/booking/ports";
import { classifyFailure, succeeded, type LiteApiBookingHttp } from "./booking-http";

const prebookSchema = z.object({
  data: z.object({
    prebookId: z.string().min(1),
    price: z.number(),
    currency: z.string(),
    boardChanged: z.boolean().optional(),
  }),
});

const bookSchema = z.object({
  data: z.object({
    bookingId: z.string().min(1),
    status: z.string(),
    hotelConfirmationCode: z.string().nullish(),
  }),
});

const cancelSchema = z.object({ data: z.object({ status: z.string() }) });

const bad = (message: string, cause?: FailureCause): Result<never, SupplierError> => err({ code: "rejected", message, ...(cause && { cause }) });

/** liteAPI limits how long a client reference may be, and ours holds two ids, so it is shortened to a fixed length. */
export const clientReferenceFor = (reference: string): string => createHash("sha256").update(reference).digest("hex").slice(0, 32);

/** The full phone number, with the country code, as the hotel wants it. */
const phoneOf = ({ details }: BookingTraveller): string => `+${details.phoneCountryCode}${details.phoneNumber}`;

/**
 * Books hotel rooms through liteAPI, paying with its sandbox account credit, so no real money moves. The price is
 * checked between "prebook" and "book", so a room that got dearer is never booked.
 */
export class LiteApiHotelSupplier implements HotelSupplier {
  constructor(private readonly http: LiteApiBookingHttp) {}

  async book(request: HotelBookingRequest): Promise<Result<SupplierReceipt, SupplierError>> {
    const prebooked = await this.http.send("hotels", "POST", "/rates/prebook", { offerId: request.offer.id, usePaymentSdk: false });
    if (!prebooked.ok) return prebooked;
    if (!succeeded(prebooked.value)) return err(classifyFailure(prebooked.value));
    const prebook = prebookSchema.safeParse(prebooked.value.body);
    if (!prebook.success) return bad("liteAPI's prebook answer was not in the expected shape", "answer_unreadable");

    const price = toMinorUnits(prebook.data.data.price, prebook.data.data.currency);
    if (price === null || prebook.data.data.currency.toUpperCase() !== request.offer.currency) return bad("liteAPI's price could not be read", "answer_unreadable");
    if (price > request.maxTotalMinor) return err({ code: "price_changed", message: "The room now costs more than the offer said" });
    // A different meal plan is a different product from what the group agreed to.
    if (prebook.data.data.boardChanged) return bad("The room's meal plan changed", "meal_plan_changed");

    const { details } = request.lead;
    const person = { firstName: details.firstName, lastName: details.lastName, email: details.email };
    const booked = await this.http.send("hotels", "POST", "/rates/book", {
      prebookId: prebook.data.data.prebookId,
      // The same reference never books twice, and a failed attempt cannot be tried again with it.
      clientReference: clientReferenceFor(request.reference),
      holder: { ...person, phone: phoneOf(request.lead) },
      // One lead guest per room: naming more than one for a room is refused.
      guests: [{ occupancyNumber: 1, ...person }],
      payment: { method: "ACC_CREDIT_CARD" },
    });
    if (!booked.ok) return booked;
    if (!succeeded(booked.value)) return err(classifyFailure(booked.value));
    const booking = bookSchema.safeParse(booked.value.body);
    if (!booking.success) return bad("liteAPI's booking answer was not in the expected shape", "answer_unreadable");

    if (booking.data.data.status !== "CONFIRMED") {
      // Not confirmed, but it exists: undo it so nothing is left behind.
      await this.cancel(booking.data.data.bookingId);
      return bad(`The room was not confirmed (${booking.data.data.status})`, "not_confirmed");
    }
    return ok({ bookingId: booking.data.data.bookingId, confirmation: booking.data.data.hotelConfirmationCode ?? null });
  }

  async cancel(bookingId: string): Promise<Result<CancelOutcome, SupplierError>> {
    const cancelled = await this.http.send("hotels", "PUT", `/bookings/${encodeURIComponent(bookingId)}`);
    if (!cancelled.ok) return cancelled;
    if (!succeeded(cancelled.value)) return err(classifyFailure(cancelled.value));
    const parsed = cancelSchema.safeParse(cancelled.value.body);
    if (!parsed.success) return bad("liteAPI's cancellation answer was not in the expected shape");
    // "Cancelled with charges" is still cancelled: the fee is the hotel's rule, not a reason to keep the booking.
    return parsed.data.data.status.startsWith("CANCEL") ? ok("cancelled") : bad(`The booking was not cancelled (${parsed.data.data.status})`);
  }
}
