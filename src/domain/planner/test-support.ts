import fixtureData from "@/data/fixture-offers.json";
import type { ConstraintSet } from "@/domain/constraints/schema";
import { parseFixtureOffers } from "@/domain/offers/fixture-offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { FxRateTable, MemberInput } from "@/domain/split/types";
import type { PlannerOutput } from "./schema";

/** Shared fixtures for the planner tests: the Bangkok trip from the wireframe. */
export const NOW = new Date("2026-10-27T01:00:00Z");
const MS_PER_MINUTE = 60_000;

export const MEMBER_IDS = ["nevin", "ana", "ben", "jia"] as const;
export const MEMBERS: readonly MemberInput[] = MEMBER_IDS.map((id) => ({ id, currency: "USD" }));
export const FX: FxRateTable = { baseCurrency: "USD", source: "test-rates", ratesPerBase: { SGD: 1.35 } };

export const BANGKOK_CONSTRAINTS: ConstraintSet = {
  ana: { outboundDeparture: { after: "18:00" } },
  ben: { budgetCap: { amountMinor: 35000, currency: "USD" } },
  jia: { ownRoom: true, skipActivityCategories: ["cooking"] },
};

const parsed = parseFixtureOffers(fixtureData);
if (!parsed.ok) throw new Error(parsed.error.message);

/** The six fixture offers, with expiry counted from NOW. */
export const BANGKOK_OFFERS: readonly Offer[] = parsed.value.map((fixture): Offer => {
  const { expiresInMinutes, ...rest } = fixture;
  return { ...rest, expiresAt: new Date(NOW.getTime() + expiresInMinutes * MS_PER_MINUTE).toISOString() };
});

export const pick = (offerId: string, memberIds: readonly string[], reason = "Fits the group") => ({
  offerId,
  reason,
  members: memberIds.map((memberId) => ({ memberId, note: "Works for them" })),
});

const ALL = [...MEMBER_IDS];

/** The plan in the wireframe: evening flight, triple room for three, single for Jia, market for all, cooking for two. */
export const WIREFRAME_PLAN: PlannerOutput = {
  title: "Bangkok weekend",
  picks: [
    pick("fx-flt-evening", ALL),
    pick("fx-htl-triple", ["nevin", "ana", "ben"]),
    pick("fx-htl-single", ["jia"]),
    pick("fx-act-market", ALL),
    pick("fx-act-cooking", ["nevin", "ana"]),
  ],
};

export const withPicks = (picks: PlannerOutput["picks"]): PlannerOutput => ({ title: "Bangkok weekend", picks });
