import { clockTime } from "@/domain/offers/local-time";
import type { Offer } from "@/domain/offers/schema";
import { shorten } from "./shared";

/** "2026-12-11T20:10:00+08:00" as "2026-12-11 20:10", the clock reading at the airport, which is what members talk about. */
const localReading = (dateTime: string): string => `${dateTime.slice(0, 10)} ${clockTime(dateTime) ?? ""}`.trim();

/**
 * What the planner sees of an offer: enough to choose well, and nothing that identifies a provider's internals.
 * Prices are shown so budgets can be weighed, but the planner's answer has no price field.
 */
export function toOfferView(offer: Offer): Record<string, unknown> {
  const common = {
    id: offer.id,
    kind: offer.kind,
    title: shorten(offer.title),
    guests: offer.guests,
    totalMinor: offer.totalMinor,
    currency: offer.currency,
    approxPerGuestMinor: Math.ceil(offer.totalMinor / offer.guests),
  };
  switch (offer.kind) {
    case "flight":
      return {
        ...common,
        refundable: offer.refundable,
        legs: offer.legs.map((leg) => ({
          direction: leg.direction,
          from: leg.origin,
          to: leg.destination,
          departsLocal: localReading(leg.departAt),
          arrivesLocal: localReading(leg.arriveAt),
        })),
      };
    case "hotel":
      return {
        ...common,
        room: shorten(offer.roomName),
        stars: offer.stars,
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        freeCancellationUntil: offer.freeCancellationUntil,
      };
    case "activity":
      return {
        ...common,
        date: offer.date,
        startsLocal: offer.startTime,
        durationMinutes: offer.durationMinutes,
        category: offer.category,
      };
  }
}
