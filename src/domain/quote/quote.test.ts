import { describe, expect, it } from "vitest";
import type { Offer } from "@/domain/offers/schema";
import { buildPlan } from "@/domain/planner/build-plan";
import { ScriptedPlanner } from "@/domain/planner/scripted-planner";
import { BANGKOK_CONSTRAINTS, BANGKOK_OFFERS, FX, MEMBERS, NOW, WIREFRAME_PLAN } from "@/domain/planner/test-support";
import { ok } from "@/lib/result";
import { buildQuote } from "./build-quote";

const built = await buildPlan({
  planner: new ScriptedPlanner({ plans: [ok(WIREFRAME_PLAN)] }),
  members: MEMBERS,
  constraints: BANGKOK_CONSTRAINTS,
  offers: BANGKOK_OFFERS,
  fx: FX,
  requiredKinds: ["flight", "hotel"],
  now: NOW,
});
if (!built.ok) throw new Error(built.error.message);

const offer = (id: string): Offer => {
  const found = BANGKOK_OFFERS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no offer ${id}`);
  return found;
};

const flight = (id: string): Extract<Offer, { kind: "flight" }> => {
  const found = offer(id);
  if (found.kind !== "flight") throw new Error(`${id} is not a flight`);
  return found;
};
const hotel = (id: string): Extract<Offer, { kind: "hotel" }> => {
  const found = offer(id);
  if (found.kind !== "hotel") throw new Error(`${id} is not a hotel`);
  return found;
};

const withExtras = (...extras: Offer[]): readonly Offer[] => [...BANGKOK_OFFERS, ...extras];

const quoteWith = (searched: readonly Offer[], overrides: Partial<Parameters<typeof buildQuote>[0]> = {}) =>
  buildQuote({ built: built.value, members: MEMBERS, constraints: BANGKOK_CONSTRAINTS, fx: FX, searched, now: NOW, ...overrides });

const alternativesFor = (quote: ReturnType<typeof quoteWith>, pickedOfferId: string) =>
  quote.alternatives.find((slot) => slot.pickedOfferId === pickedOfferId)?.alternatives ?? [];

describe("offer quotes", () => {
  const quote = quoteWith(BANGKOK_OFFERS);

  it("shows each offer's price, who it covers and what each of them pays", () => {
    const triple = quote.offers.find((o) => o.offerId === "fx-htl-triple");
    expect(triple).toMatchObject({ kind: "hotel", totalMinor: 42000, memberIds: ["nevin", "ana", "ben"] });
    expect(triple?.perMemberMinor).toEqual({ nevin: 14000, ana: 14000, ben: 14000 });
    expect(quote.offers.find((o) => o.offerId === "fx-act-cooking")?.perMemberMinor).toEqual({ nevin: 4500, ana: 4500 });
  });

  it("describes offers in a line that tells them apart", () => {
    expect(quote.offers.find((o) => o.offerId === "fx-flt-evening")?.detail).toBe("Out 20:10, back 21:30, Scoot");
    expect(quote.offers.find((o) => o.offerId === "fx-htl-single")?.detail).toBe("Single room, 4-star, 2026-12-11 to 2026-12-13");
    expect(quote.offers.find((o) => o.offerId === "fx-act-market")?.detail).toBe("tour, 240 min, 2026-12-12");
  });

  it("states what can be cancelled and when", () => {
    expect(quote.offers.find((o) => o.offerId === "fx-flt-evening")).toMatchObject({ refundable: false, freeCancellationUntil: null });
    expect(quote.offers.find((o) => o.offerId === "fx-htl-triple")).toMatchObject({ refundable: true, freeCancellationUntil: "2026-12-10T12:00:00Z" });
    expect(quote.offers.find((o) => o.offerId === "fx-act-market")).toMatchObject({ refundable: null });
  });

  it("lists charges the hotel collects on top of the price, and none when there are none", () => {
    expect(quote.offers.find((o) => o.offerId === "fx-htl-triple")?.excludedCharges).toEqual([]);
    const taxed: Offer = { ...hotel("fx-htl-triple"), excludedCharges: [{ description: "City tax", amountMinor: 900, currency: "USD" }] };
    const taxedBuilt = { ...built.value, plan: { ...built.value.plan, picks: built.value.plan.picks.map((p) => (p.offer.id === "fx-htl-triple" ? { ...p, offer: taxed } : p)) } };
    const withTax = buildQuote({ built: taxedBuilt, members: MEMBERS, constraints: BANGKOK_CONSTRAINTS, fx: FX, searched: BANGKOK_OFFERS, now: NOW });
    expect(withTax.offers.find((o) => o.offerId === "fx-htl-triple")?.excludedCharges).toEqual([{ description: "City tax", amountMinor: 900, currency: "USD" }]);
  });

  it("totals the plan and passes on who is not fully served", () => {
    expect(quote).toMatchObject({ currency: "USD", totalMinor: 155000, violations: [] });
  });
});

describe("member quotes", () => {
  const quote = quoteWith(BANGKOK_OFFERS);
  const member = (id: string) => quote.members.find((m) => m.memberId === id);

  it("gives each person's share with the lines it is made of", () => {
    expect(quote.members.map((m) => [m.memberId, m.shareMinor])).toEqual([["nevin", 39500], ["ana", 39500], ["ben", 35000], ["jia", 41000]]);
    expect(member("jia")?.lines.map((l) => [l.itemId, l.baseMinor])).toEqual([["fx-flt-evening", 18000], ["fx-htl-single", 20000], ["fx-act-market", 3000]]);
  });

  it("shows how far each person is from their budget", () => {
    expect(member("ben")?.budget).toEqual({ capMinor: 35000, headroomMinor: 0 });
    expect(member("nevin")?.budget).toBeNull();
  });

  it("shows being over budget as negative headroom", () => {
    const tight = quoteWith(BANGKOK_OFFERS, { constraints: { ben: { budgetCap: { amountMinor: 34000, currency: "USD" } } } });
    expect(tight.members.find((m) => m.memberId === "ben")?.budget?.headroomMinor).toBe(-1000);
  });

  it("leaves the budget out when it is in another currency, and shows the exchange rate for foreign members", () => {
    const sgd = quoteWith(BANGKOK_OFFERS, { constraints: { ben: { budgetCap: { amountMinor: 50000, currency: "SGD" } } } });
    expect(sgd.members.find((m) => m.memberId === "ben")?.budget).toBeNull();
    expect(member("ana")).toMatchObject({ currency: "USD", fxRate: 1, fxSource: "test-rates" });
  });
});

describe("alternatives", () => {
  const cheaperEvening: Offer = { ...flight("fx-flt-evening"), id: "alt-evening", listingId: "alt-evening-listing", totalMinor: 68000 };

  it("rules out the early flight for Ana and says why, with the saving", () => {
    const [early] = alternativesFor(quoteWith(BANGKOK_OFFERS), "fx-flt-evening");
    expect(early).toMatchObject({ offerId: "fx-flt-early", status: "ruled_out", priceDiffMinor: -6000 });
    expect(early.detail).toBe("Out 13:05, back 18:40, Scoot");
    expect(early.breaks).toEqual([expect.objectContaining({ memberId: "ana", kind: "departure_window" })]);
    expect(early.breaks[0].message).toContain("13:05");
    expect(early.memberDiffMinor).toEqual({ nevin: -1500, ana: -1500, ben: -1500, jia: -1500 });
  });

  it("offers a viable alternative when nothing would break", () => {
    const [alt] = alternativesFor(quoteWith(withExtras(cheaperEvening)), "fx-flt-evening");
    expect(alt).toMatchObject({ offerId: "alt-evening", status: "viable", priceDiffMinor: -4000, breaks: [] });
  });

  it("puts viable alternatives before ruled-out ones, each cheapest first, even when a ruled-out one is the cheapest", () => {
    // Ben is exactly at his cap, so only offers priced at or below the chosen flight can be viable.
    const middle: Offer = { ...cheaperEvening, id: "alt-mid", listingId: "alt-mid-listing", totalMinor: 70000 };
    const ids = alternativesFor(quoteWith(withExtras(middle, cheaperEvening)), "fx-flt-evening").map((a) => a.offerId);
    expect(ids).toEqual(["alt-evening", "alt-mid", "fx-flt-early"]);
  });

  it("rules out a pricier flight because it pushes Ben, who is at his cap, over budget", () => {
    const pricier: Offer = { ...cheaperEvening, id: "alt-pricey", listingId: "alt-pricey-listing", totalMinor: 90000 };
    const [alt] = alternativesFor(quoteWith(withExtras(pricier)), "fx-flt-evening").filter((a) => a.offerId === "alt-pricey");
    expect(alt).toMatchObject({ status: "ruled_out", priceDiffMinor: 18000 });
    expect(alt.breaks).toEqual([expect.objectContaining({ memberId: "ben", kind: "budget_cap" })]);
  });

  it("rules out a hotel that pushes someone over budget", () => {
    const luxury: Offer = { ...hotel("fx-htl-triple"), id: "alt-luxury", listingId: "alt-luxury-listing", totalMinor: 60000 };
    const [alt] = alternativesFor(quoteWith(withExtras(luxury)), "fx-htl-triple");
    expect(alt).toMatchObject({ offerId: "alt-luxury", status: "ruled_out", priceDiffMinor: 18000 });
    expect(alt.breaks).toEqual([expect.objectContaining({ memberId: "ben", kind: "budget_cap" })]);
    expect(alt.memberDiffMinor).toEqual({ nevin: 6000, ana: 6000, ben: 6000 });
  });

  it("offers a cheaper room as a real alternative", () => {
    const cheap: Offer = { ...hotel("fx-htl-triple"), id: "alt-cheap", listingId: "alt-cheap-listing", totalMinor: 36000 };
    expect(alternativesFor(quoteWith(withExtras(cheap)), "fx-htl-triple")[0]).toMatchObject({ status: "viable", priceDiffMinor: -6000 });
  });

  it("shows what a swap would fix when the chosen plan is a compromise", () => {
    const compromised = { ...built.value, violations: [{ memberId: "ana", kind: "departure_window" as const, offerId: "fx-flt-evening", message: "ana is unhappy" }] };
    const quote = buildQuote({ built: compromised, members: MEMBERS, constraints: BANGKOK_CONSTRAINTS, fx: FX, searched: withExtras(cheaperEvening), now: NOW });
    const byId = (id: string) => alternativesFor(quote, "fx-flt-evening").find((a) => a.offerId === id);
    expect(byId("alt-evening")?.fixes).toEqual([expect.objectContaining({ memberId: "ana" })]);
    // The early flight shares Ana's existing compromise: nothing new breaks, and nothing is fixed.
    expect(byId("fx-flt-early")).toMatchObject({ status: "viable", breaks: [], fixes: [] });
  });

  it("skips offers that cannot take the place", () => {
    const wrongGuests: Offer = { ...flight("fx-flt-evening"), id: "g", listingId: "g", guests: 3 };
    const wrongCurrency: Offer = { ...flight("fx-flt-evening"), id: "c", listingId: "c", currency: "SGD" };
    const expired: Offer = { ...cheaperEvening, id: "e", listingId: "e", expiresAt: NOW.toISOString() };
    const sameListing: Offer = { ...cheaperEvening, id: "s", listingId: "SIN-BKK-TR-868-1" };
    const otherRoute: Offer = { ...cheaperEvening, id: "r", listingId: "r", legs: [{ ...flight("fx-flt-evening").legs[0], destination: "HKT" }] };
    const otherDates: Offer = { ...hotel("fx-htl-triple"), id: "d", listingId: "d", checkOut: "2026-12-14" };
    const quote = quoteWith(withExtras(wrongGuests, wrongCurrency, expired, sameListing, otherRoute, otherDates));
    expect(alternativesFor(quote, "fx-flt-evening").map((a) => a.offerId)).toEqual(["fx-flt-early"]);
    expect(alternativesFor(quote, "fx-htl-triple")).toEqual([]);
  });

  it("does not offer a picked offer as an alternative to another pick", () => {
    expect(alternativesFor(quoteWith(BANGKOK_OFFERS), "fx-htl-single")).toEqual([]);
  });

  it("only looks for alternatives to flights and hotels", () => {
    expect(quoteWith(BANGKOK_OFFERS).alternatives.map((slot) => slot.pickedOfferId)).toEqual(["fx-flt-evening", "fx-htl-triple", "fx-htl-single"]);
  });

  it("limits how many alternatives each slot shows", () => {
    const many = Array.from({ length: 6 }, (_, i): Offer => ({ ...cheaperEvening, id: `m${i}`, listingId: `m${i}`, totalMinor: 60000 + i }));
    expect(alternativesFor(quoteWith(withExtras(...many)), "fx-flt-evening")).toHaveLength(3);
    expect(alternativesFor(quoteWith(withExtras(...many), { maxPerSlot: 5 }), "fx-flt-evening")).toHaveLength(5);
  });
});
