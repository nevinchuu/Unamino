import type { Offer } from "@/domain/offers/schema";
import type { LineItem } from "@/domain/split/types";
import type { ValidatedPlan } from "./validate";

/** One cost for a picked offer, shared equally by exactly the members it is for. */
export const toLineItem = (offer: Offer, memberIds: readonly string[]): LineItem => ({
  id: offer.id,
  label: offer.kind === "hotel" ? `${offer.title} (${offer.roomName})` : offer.title,
  totalMinor: offer.totalMinor,
  allocation: { type: "equal", memberIds },
});

/** One cost per picked offer. */
export const toLineItems = (plan: ValidatedPlan): readonly LineItem[] => plan.picks.map(({ offer, memberIds }) => toLineItem(offer, memberIds));
