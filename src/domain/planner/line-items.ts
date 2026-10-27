import type { LineItem } from "@/domain/split/types";
import type { ValidatedPlan } from "./validate";

/** One cost per picked offer, shared equally by exactly the members that offer is for. */
export function toLineItems(plan: ValidatedPlan): readonly LineItem[] {
  return plan.picks.map(({ offer, memberIds }) => ({
    id: offer.id,
    label: offer.kind === "hotel" ? `${offer.title} (${offer.roomName})` : offer.title,
    totalMinor: offer.totalMinor,
    allocation: { type: "equal", memberIds },
  }));
}
