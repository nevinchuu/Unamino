import { clockTime } from "@/domain/offers/local-time";
import type { Offer } from "@/domain/offers/schema";

/** A short line that tells offers of the same kind apart. Plain text, safe to show as is. */
export function describeOffer(offer: Offer): string {
  switch (offer.kind) {
    case "hotel": {
      const stars = offer.stars === undefined ? "" : `, ${offer.stars}-star`;
      return `${offer.roomName}${stars}, ${offer.checkIn} to ${offer.checkOut}`;
    }
    case "flight": {
      const out = offer.legs.find((leg) => leg.direction === "outbound");
      const back = offer.legs.find((leg) => leg.direction === "inbound");
      const outTime = out ? clockTime(out.departAt) : null;
      const backTime = back ? clockTime(back.departAt) : null;
      return [out && outTime ? `Out ${outTime}` : null, back && backTime ? `back ${backTime}` : null, out?.carrier]
        .filter((part): part is string => part !== null && part !== undefined)
        .join(", ");
    }
    case "activity":
      return `${offer.category}, ${offer.durationMinutes} min, ${offer.date}`;
  }
}
