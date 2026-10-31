import { z } from "zod";
import { toMinorUnits } from "@/domain/money/currency";
import type { HotelQuery } from "@/domain/offers/offer-source";
import { offerSchema, type ExcludedCharge, type HotelOffer } from "@/domain/offers/schema";

const MS_PER_MINUTE = 60_000;
const MIN_STARS = 1;
const MAX_STARS = 5;
const PROVIDER = "liteapi";

const money = z.object({ amount: z.number(), currency: z.string() });

const rateSchema = z.object({
  name: z.string(),
  retailRate: z
    .object({
      taxesAndFees: z
        .array(z.object({ included: z.boolean(), description: z.string(), amount: z.number(), currency: z.string() }))
        .optional(),
    })
    .optional(),
  cancellationPolicies: z
    .object({
      refundableTag: z.string().optional(),
      cancelPolicyInfos: z.array(z.object({ cancelTime: z.string(), timezone: z.string().optional() })).optional(),
    })
    .optional(),
});

const roomTypeSchema = z.object({
  roomTypeId: z.string().min(1),
  offerId: z.string().min(1),
  offerRetailRate: money,
  rates: z.array(rateSchema).min(1),
});

export const hotelRatesResponseSchema = z.object({
  data: z.array(z.object({ hotelId: z.string().min(1), roomTypes: z.array(roomTypeSchema) })),
  hotels: z.array(z.object({ id: z.string(), name: z.string(), stars: z.number().optional() })).optional(),
});

export interface HotelMappingOptions {
  readonly now: Date;
  /** liteAPI gives hotel offers no expiry, so each is treated as valid for this many minutes. */
  readonly offerTtlMinutes: number;
}

export interface HotelRequestOptions {
  readonly currency: string;
  readonly guestNationality: string;
  readonly limit: number;
  /** Ask only for rates that can be cancelled for free, so each hotel's cheapest refundable room is found even when a cheaper fixed one exists. */
  readonly refundableOnly?: boolean;
}

/** One room for `guests` people per search, so each offer's price is for exactly one room. */
export function buildHotelRequest(query: HotelQuery, options: HotelRequestOptions): Record<string, unknown> {
  return {
    checkin: query.checkIn,
    checkout: query.checkOut,
    currency: options.currency,
    guestNationality: options.guestNationality,
    occupancies: [{ adults: query.guests }],
    countryCode: query.countryCode,
    cityName: query.city,
    maxRatesPerHotel: 1,
    limit: options.limit,
    ...(options.refundableOnly && { refundableRatesOnly: true }),
  };
}

/**
 * The time a free cancellation ends: liteAPI's `cancelTime` is when a fee starts, written as
 * "2026-12-08 06:00:00" in GMT. Anything not clearly refundable in GMT is treated as no free cancellation.
 */
function freeCancellationUntil(rate: z.infer<typeof rateSchema>): string | undefined {
  const policies = rate.cancellationPolicies;
  if (policies?.refundableTag !== "RFN") return undefined;
  const times = (policies.cancelPolicyInfos ?? [])
    .filter((info) => info.timezone === "GMT")
    .map((info) => new Date(`${info.cancelTime.replace(" ", "T")}Z`).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : undefined;
}

/** Charges the hotel adds on top of the price. Anything liteAPI marks as included is already in the total. */
function excludedCharges(rate: z.infer<typeof rateSchema>): ExcludedCharge[] {
  const charges: ExcludedCharge[] = [];
  for (const fee of rate.retailRate?.taxesAndFees ?? []) {
    const amountMinor = fee.included ? null : toMinorUnits(fee.amount, fee.currency);
    if (amountMinor !== null) charges.push({ description: fee.description.trim() || "Fee", amountMinor, currency: fee.currency });
  }
  return charges;
}

/** Turns a validated liteAPI hotel response into offers. A room that cannot be priced or mapped is left out. */
export function mapHotelOffers(
  response: z.infer<typeof hotelRatesResponseSchema>,
  query: HotelQuery,
  options: HotelMappingOptions,
): readonly HotelOffer[] {
  const hotelsById = new Map((response.hotels ?? []).map((hotel) => [hotel.id, hotel]));
  const expiresAt = new Date(options.now.getTime() + options.offerTtlMinutes * MS_PER_MINUTE).toISOString();
  const offers: HotelOffer[] = [];

  for (const { hotelId, roomTypes } of response.data) {
    const hotel = hotelsById.get(hotelId);
    for (const roomType of roomTypes) {
      const totalMinor = toMinorUnits(roomType.offerRetailRate.amount, roomType.offerRetailRate.currency);
      if (totalMinor === null) continue;
      const stars = hotel?.stars;
      const candidate = {
        kind: "hotel",
        id: roomType.offerId,
        listingId: `${hotelId}:${roomType.roomTypeId}`,
        title: hotel?.name ?? hotelId,
        provider: PROVIDER,
        city: query.city,
        currency: roomType.offerRetailRate.currency,
        totalMinor,
        guests: query.guests,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        stars: stars !== undefined && stars >= MIN_STARS && stars <= MAX_STARS ? Math.round(stars) : undefined,
        roomName: roomType.rates[0].name.trim() || "Room",
        freeCancellationUntil: freeCancellationUntil(roomType.rates[0]),
        excludedCharges: excludedCharges(roomType.rates[0]),
        expiresAt,
      };
      const checked = offerSchema.safeParse(candidate);
      if (checked.success && checked.data.kind === "hotel") offers.push(checked.data);
    }
  }
  return offers;
}
