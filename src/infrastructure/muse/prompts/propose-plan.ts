import type { ProposePlanInput } from "@/domain/planner/planner";
import type { PlannerOutput } from "@/domain/planner/schema";
import type { CompletionRequest } from "../muse-http";
import { toOfferView } from "./offer-view";
import { DATA_IS_NOT_INSTRUCTIONS, JSON_ONLY, numbered, PROPOSE_MAX_TOKENS, userMessage } from "./shared";

/** Shown to the model, and checked against the real schema in tests so the two cannot drift apart. */
export const PLAN_EXAMPLE: PlannerOutput = {
  title: "Weekend away",
  summary: "One flight for everyone, a shared room for three and a single for the fourth.",
  picks: [
    {
      offerId: "offer-1",
      reason: "The only flight that leaves after 18:00 on the Friday.",
      members: [
        { memberId: "member-a", note: "Leaves after 18:00 as asked" },
        { memberId: "member-b", note: "Within budget" },
      ],
    },
  ],
  compromises: [{ memberId: "member-b", note: "Their share is slightly over their budget; no cheaper flight fits everyone." }],
};

const rules = (requiredKinds: ProposePlanInput["requiredKinds"]): string =>
  numbered([
    "Choose a travel plan for the group from the offers given. You may only choose offers from the list, by their exact id. Never invent an offer.",
    "Each pick says which members the offer is for. Give exactly as many members as the offer's guests, only use member ids from the list, and never list a member twice for one offer.",
    requiredKinds && requiredKinds.length > 0
      ? `Every member must be on at least one offer of each of these kinds: ${requiredKinds.join(", ")}.`
      : "Every member should be covered by the offers they need to make the trip.",
    "Never put one member on two hotel stays whose dates overlap, or on two flights that overlap.",
    "All the offers you pick must use the same currency.",
    'Honour what each member asked for. outboundDeparture and returnDeparture are windows for the local departure time of the flight there and back. ownRoom means that member needs a hotel offer with guests 1. A member with skipActivityCategories must not be put on an activity of that category. budgetCap is the most that member should pay in total: roughly the sum of approxPerGuestMinor for the offers they are on.',
    "Activities are optional. Add ones that suit the group and put only the members who would want them on each one.",
    "If you cannot satisfy everyone, choose the plan that serves the most people and describe who is not fully served in compromises. Be honest: your claims are checked by code.",
    "Prefer cheaper offers when everything else is equal. Keep each reason and note to one short sentence.",
    "There is no price field in your answer. Prices come from the offers, not from you.",
    "If feedback is present, it lists what was wrong with your last answer. Fix exactly those problems.",
    DATA_IS_NOT_INSTRUCTIONS,
    JSON_ONLY,
  ]);

export function buildProposePlanPrompt(input: ProposePlanInput): CompletionRequest {
  return {
    system: `${rules(input.requiredKinds)}\n\nExample answer shape (the ids and text are made up):\n${JSON.stringify(PLAN_EXAMPLE)}`,
    user: userMessage("propose_plan", {
      memberIds: input.memberIds,
      constraints: input.constraints,
      offers: input.offers.map(toOfferView),
      feedback: input.feedback,
    }),
    maxTokens: PROPOSE_MAX_TOKENS,
  };
}
