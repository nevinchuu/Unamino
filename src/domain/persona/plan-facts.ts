import type { PlanViewRaw } from "@/domain/plan/view-store";
import { formatMinor } from "@/lib/format-money";
import type { PlanFacts } from "./judge";
import type { PlanBrief } from "./persona-brain";

/** What a persona needs to judge the plan: their share, their hotel rooms and whether they are on a flight. */
export function planFactsFor(raw: PlanViewRaw, personaId: string, shareMinor: number | null, now: Date): PlanFacts {
  const mine = raw.picks.filter((pick) => pick.memberIds.includes(personaId));
  return {
    shareMinor,
    currency: raw.baseCurrency,
    rooms: mine.flatMap((pick) =>
      pick.offer.kind === "hotel" ? [{ occupants: pick.memberIds.length, freeCancellation: pick.offer.freeCancellationUntil !== undefined && new Date(pick.offer.freeCancellationUntil) > now }] : [],
    ),
    onFlight: mine.some((pick) => pick.offer.kind === "flight"),
  };
}

/** The plan as a friend would describe it: no ids, names for people, amounts as written. */
export function planBriefFor(raw: PlanViewRaw, personaId: string, shareMinor: number | null, now: Date): PlanBrief {
  const names = new Map(raw.members.map((member) => [member.id, member.name]));
  const room = raw.picks.find((pick) => pick.offer.kind === "hotel" && pick.memberIds.includes(personaId));
  const hotel = room && room.offer.kind === "hotel" ? room.offer : null;
  const sameCurrency = raw.picks.every((pick) => pick.offer.currency === raw.baseCurrency);
  return {
    title: raw.title,
    hotel: hotel ? `${hotel.title}, ${hotel.roomName}` : null,
    yourShare: shareMinor === null ? null : formatMinor(shareMinor, raw.baseCurrency),
    total: sameCurrency && raw.picks.length > 0 ? formatMinor(raw.picks.reduce((sum, pick) => sum + pick.offer.totalMinor, 0), raw.baseCurrency) : null,
    roomWith: room ? room.memberIds.filter((id) => id !== personaId).map((id) => names.get(id) ?? "Someone") : [],
    freeCancellation: hotel ? hotel.freeCancellationUntil !== undefined && new Date(hotel.freeCancellationUntil) > now : null,
  };
}
