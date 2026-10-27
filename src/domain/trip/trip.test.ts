import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { OfferQuery, OfferSource } from "@/domain/offers/offer-source";
import { BANGKOK_OFFERS } from "@/domain/planner/test-support";
import { assessTripBrief, mergeTripFields, type CompleteTrip } from "./brief";
import { parseTripBriefText, tripFieldsSchema } from "./brief-schema";
import { MAX_ROOM_SIZE, tripToQueries } from "./queries";
import { searchForTrip } from "./search";

const TODAY = "2026-10-27";
const BANGKOK = {
  destinationCity: "Bangkok",
  destinationCountry: "TH",
  destinationAirport: "BKK",
  originAirport: "SIN",
  departDate: "2026-12-11",
  returnDate: "2026-12-13",
};
const TRIP: CompleteTrip = BANGKOK;

describe("the trip fields the model returns", () => {
  it("accepts a partial reading, because most chats start without everything", () => {
    const parsed = parseTripBriefText('{"fields":{"destinationCity":"Bangkok"},"questions":["What dates?"]}');
    expect(parsed.ok && parsed.value.fields).toEqual({ destinationCity: "Bangkok" });
  });

  it("treats null as not mentioned, which models often write instead of leaving a field out", () => {
    const parsed = parseTripBriefText('{"fields":{"destinationCity":"Bangkok","departDate":null,"originAirport":null},"questions":[]}');
    expect(parsed.ok && parsed.value.fields.departDate).toBeUndefined();
    expect(parsed.ok && parsed.value.fields.destinationCity).toBe("Bangkok");
  });

  it("rejects anything that is not a field, a malformed code or date, and too many questions", () => {
    expect(parseTripBriefText('{"fields":{"price":100},"questions":[]}').ok).toBe(false);
    expect(parseTripBriefText('{"fields":{"originAirport":"Singapore"},"questions":[]}').ok).toBe(false);
    expect(parseTripBriefText('{"fields":{"destinationCountry":"Thailand"},"questions":[]}').ok).toBe(false);
    expect(parseTripBriefText('{"fields":{"departDate":"next Friday"},"questions":[]}').ok).toBe(false);
    expect(parseTripBriefText('{"fields":{},"questions":["a","b","c","d"]}').ok).toBe(false);
  });

  it("accepts code fences around the JSON", () => {
    expect(parseTripBriefText('```json\n{"fields":{},"questions":[]}\n```').ok).toBe(true);
    expect(tripFieldsSchema.safeParse({}).success).toBe(true);
  });
});

describe("assessing a trip", () => {
  it("is complete when everything a search needs is known and sensible", () => {
    expect(assessTripBrief({ fields: BANGKOK, modelQuestions: [], today: TODAY })).toEqual({ status: "complete", trip: TRIP });
  });

  it("allows leaving today", () => {
    expect(assessTripBrief({ fields: { ...BANGKOK, departDate: TODAY, returnDate: "2026-10-29" }, modelQuestions: [], today: TODAY }).status).toBe("complete");
  });

  it("asks one question for each gap when the model asked none, folding both dates into one", () => {
    const result = assessTripBrief({ fields: {}, modelQuestions: [], today: TODAY });
    expect(result.status === "incomplete" && result.missing).toEqual(["destination", "origin", "departDate", "returnDate"]);
    expect(result.status === "incomplete" && result.questions).toEqual([
      "Where would you like to go?",
      "Which city or airport will everyone fly from?",
      "What dates would you like to travel, leaving and coming back?",
    ]);
  });

  it("asks only about the date that is missing", () => {
    const result = assessTripBrief({ fields: { ...BANGKOK, returnDate: undefined }, modelQuestions: [], today: TODAY });
    expect(result.status === "incomplete" && result.questions).toEqual(["What date do you want to come back?"]);
  });

  it("counts a destination without its airport as missing, because the flight search needs it", () => {
    const result = assessTripBrief({ fields: { ...BANGKOK, destinationAirport: undefined }, modelQuestions: [], today: TODAY });
    expect(result.status === "incomplete" && result.missing).toEqual(["destination"]);
  });

  it("uses the model's own questions when it asked some", () => {
    const result = assessTripBrief({ fields: { destinationCity: "Bangkok" }, modelQuestions: ["Which month works for everyone?"], today: TODAY });
    expect(result.status === "incomplete" && result.questions).toEqual(["Which month works for everyone?"]);
  });

  it.each([
    ["a departure date in the past", { departDate: "2026-10-26", returnDate: "2026-10-30" }, "has already passed"],
    ["a return date in the past", { departDate: "2026-10-20", returnDate: "2026-10-25" }, "has already passed"],
    ["a return before the departure", { departDate: "2026-12-13", returnDate: "2026-12-11" }, "is before the departure date"],
    ["a trip over 30 days", { departDate: "2026-12-01", returnDate: "2027-01-15" }, "longer than 30 days"],
    ["a departure over a year away", { departDate: "2028-01-01", returnDate: "2028-01-05" }, "more than a year away"],
  ])("does not search for %s, and asks about it in code even if the model did not", (_name, dates, text) => {
    const result = assessTripBrief({ fields: { ...BANGKOK, ...dates }, modelQuestions: [], today: TODAY });
    expect(result.status).toBe("incomplete");
    expect(result.status === "incomplete" && result.problems.join(" ")).toContain(text);
    expect(result.status === "incomplete" && result.questions[0]).toContain(text);
  });

  it("puts the code's own questions first, removes repeats, and never asks more than three", () => {
    const result = assessTripBrief({
      fields: { ...BANGKOK, departDate: "2026-10-01", returnDate: "2026-09-01" },
      modelQuestions: ["a?", "b?", "c?"],
      today: TODAY,
    });
    expect(result.status === "incomplete" && result.questions).toHaveLength(3);
    expect(result.status === "incomplete" && result.questions[0]).toContain("has already passed");
  });
});

describe("merging what the group says over time", () => {
  it("keeps what was settled when a later message mentions only one thing", () => {
    expect(mergeTripFields(BANGKOK, { departDate: "2026-12-18", returnDate: "2026-12-20" })).toEqual({ ...BANGKOK, departDate: "2026-12-18", returnDate: "2026-12-20" });
  });

  it("moves the destination as one unit, so an old airport never survives a new city", () => {
    const merged = mergeTripFields(BANGKOK, { destinationCity: "Phuket", destinationCountry: "TH", destinationAirport: "HKT" });
    expect(merged).toMatchObject({ destinationCity: "Phuket", destinationAirport: "HKT", originAirport: "SIN" });
    const half = mergeTripFields(BANGKOK, { destinationCity: "Chiang Mai" });
    expect(half.destinationCity).toBe("Chiang Mai");
    expect(half.destinationAirport).toBeUndefined();
  });

  it("starts from nothing", () => {
    expect(mergeTripFields(undefined, { originAirport: "SIN" })).toMatchObject({ originAirport: "SIN", destinationCity: undefined });
  });
});

describe("turning a trip into searches", () => {
  it("searches one round-trip flight for everyone and a hotel for each room size", () => {
    const queries = tripToQueries(TRIP, 4);
    expect(queries).toHaveLength(5);
    expect(queries[0]).toEqual({ kind: "flight", city: "Bangkok", origin: "SIN", destination: "BKK", departDate: "2026-12-11", returnDate: "2026-12-13", guests: 4 });
    expect(queries.slice(1)).toEqual([1, 2, 3, 4].map((guests) => ({ kind: "hotel", city: "Bangkok", countryCode: "TH", checkIn: "2026-12-11", checkOut: "2026-12-13", guests })));
  });

  it("searches only the room sizes a small group could use", () => {
    expect(tripToQueries(TRIP, 1).map((q) => q.kind)).toEqual(["flight", "hotel"]);
    expect(tripToQueries(TRIP, 2).filter((q) => q.kind === "hotel").map((q) => q.guests)).toEqual([1, 2]);
  });

  it("caps room size for a big group while the flight still covers everyone", () => {
    const queries = tripToQueries(TRIP, 9);
    expect(queries[0].guests).toBe(9);
    expect(Math.max(...queries.slice(1).map((q) => q.guests))).toBe(MAX_ROOM_SIZE);
  });

  it("makes no searches without travellers", () => {
    for (const headcount of [0, -1, 2.5, Number.NaN]) expect(tripToQueries(TRIP, headcount)).toEqual([]);
  });
});

describe("running the searches", () => {
  const flightOffers = BANGKOK_OFFERS.filter((o) => o.kind === "flight");
  const hotelOffers = BANGKOK_OFFERS.filter((o) => o.kind === "hotel");

  const sourceWith = (answer: (query: OfferQuery) => ReturnType<OfferSource["search"]>): { source: OfferSource; seen: OfferQuery[] } => {
    const seen: OfferQuery[] = [];
    return { seen, source: { search: (query) => { seen.push(query); return answer(query); } } };
  };

  it("runs every search and gathers what they found, with the query that found each", async () => {
    const { source, seen } = sourceWith(async (q) => ok(q.kind === "flight" ? flightOffers : hotelOffers));
    const result = await searchForTrip(source, TRIP, 4);
    if (!result.ok) throw new Error(result.error.message);
    expect(seen).toHaveLength(5);
    expect(result.value.searches.map((s) => s.query.kind)).toEqual(["flight", "hotel", "hotel", "hotel", "hotel"]);
    expect(result.value.failures).toEqual([]);
  });

  it("lists each offer once even when two searches return it", async () => {
    const { source } = sourceWith(async () => ok(hotelOffers));
    const result = await searchForTrip(source, TRIP, 4);
    expect(result.ok && result.value.offers.map((o) => o.id)).toEqual(hotelOffers.map((o) => o.id));
  });

  it("keeps going when one search fails, so a hotel size failing does not hide the flights", async () => {
    const { source } = sourceWith(async (q) => (q.kind === "hotel" && q.guests === 3 ? err({ code: "source_unavailable", message: "busy" }) : ok(q.kind === "flight" ? flightOffers : [])));
    const result = await searchForTrip(source, TRIP, 4);
    expect(result.ok && result.value.failures).toHaveLength(1);
    expect(result.ok && result.value.failures[0].query).toMatchObject({ kind: "hotel", guests: 3 });
    expect(result.ok && result.value.offers.length).toBe(flightOffers.length);
  });

  it("is an error only when every search fails", async () => {
    const { source } = sourceWith(async () => err({ code: "source_unavailable", message: "liteAPI is down" }));
    const result = await searchForTrip(source, TRIP, 4);
    expect(result.ok ? null : result.error).toEqual({ code: "source_unavailable", message: "liteAPI is down" });
  });

  it("treats a search that found nothing as a result, not a failure", async () => {
    const { source } = sourceWith(async () => ok([]));
    const result = await searchForTrip(source, TRIP, 2);
    expect(result.ok && result.value.offers).toEqual([]);
    expect(result.ok && result.value.searches).toHaveLength(3);
  });

  it("refuses to search for nobody", async () => {
    const { source, seen } = sourceWith(async () => ok([]));
    const result = await searchForTrip(source, TRIP, 0);
    expect(result.ok ? null : result.error.code).toBe("invalid_query");
    expect(seen).toEqual([]);
  });
});
