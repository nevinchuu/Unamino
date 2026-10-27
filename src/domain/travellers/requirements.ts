import type { ViewPick } from "@/domain/plan/view-store";

/**
 * Whether this member must give a passport: when they take part in any flight. International flights need one for
 * every passenger, and the airport codes carry no country, so every flight is treated alike rather than guessed at.
 */
export function passportRequiredFor(picks: readonly Pick<ViewPick, "offer" | "memberIds">[], memberId: string): boolean {
  return picks.some((pick) => pick.offer.kind === "flight" && pick.memberIds.includes(memberId));
}
