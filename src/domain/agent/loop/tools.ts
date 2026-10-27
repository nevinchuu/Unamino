import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { formatMinor } from "@/lib/format-money";
import { clockTime } from "@/domain/offers/local-time";
import type { FlightOffer, HotelOffer, Offer } from "@/domain/offers/schema";
import { prefilterOffers } from "@/domain/planner/prefilter";
import { assessTripBrief } from "@/domain/trip/brief";
import { searchForTrip } from "@/domain/trip/search";
import type { ToolSpec } from "./model";
import { proposePlan } from "./propose-plan";
import { members, type RosterEntry, type ToolEnv } from "./session";

const iata = z.string().regex(/^[A-Z]{3}$/, "a 3-letter airport code in capitals");
const searchArgs = z.strictObject({
  destinationCity: z.string().trim().min(1).max(80),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/, "a 2-letter country code in capitals"),
  destinationAirport: iata,
  originAirport: iata,
  departDate: z.iso.date(),
  returnDate: z.iso.date(),
  flyers: z.array(z.string().trim().min(1).max(8)).max(12).optional(),
});

/** What the agent may do. The schemas are for the model; the checks that matter are repeated in code when a tool runs. */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "search_trip",
    description:
      "Look up real round-trip flights and hotels (sandbox test data) for the whole group. Needs the destination, where everyone flies from, and both dates. Flights are priced for the people who fly: everyone, unless you list `flyers` because someone is already at the destination or has their own way there (they still get a hotel room). Returns a short list of options with short ids (F1.., H1..) and prices. Call it again with different dates or airports to compare.",
    parameters: {
      type: "object",
      properties: {
        destinationCity: { type: "string", description: "City name in English, e.g. Bangkok" },
        destinationCountry: { type: "string", description: "2-letter ISO country code in capitals, e.g. TH" },
        destinationAirport: { type: "string", description: "3-letter code of the main airport for that city, e.g. BKK" },
        originAirport: { type: "string", description: "3-letter code of the airport the group flies from, e.g. SIN" },
        departDate: { type: "string", description: "YYYY-MM-DD" },
        returnDate: { type: "string", description: "YYYY-MM-DD" },
        flyers: { type: "array", items: { type: "string" }, description: "Only when not everyone needs a flight: the ids of the people who do, e.g. [\"m1\"]. Leave it out when everyone flies. Use [] when nobody needs one." },
      },
      required: ["destinationCity", "destinationCountry", "destinationAirport", "originAirport", "departDate", "returnDate"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_plan",
    description:
      "Put a plan in front of the group to approve, made only of options from the latest search_trip. Every member needs a hotel room, and everyone who flies needs a flight (everyone, unless search_trip was given `flyers`). A hotel room's size is fixed: a room for 3 must have exactly 3 people on it. The system checks the pick, prices it and saves it; if something is wrong you get an error to fix. Returns the total and each person's share.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short plan title" },
        summary: { type: "string", description: "One sentence" },
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              offerId: { type: "string", description: "A short id from search_trip, e.g. F1 or H2" },
              reason: { type: "string", description: "One short sentence" },
              members: {
                type: "array",
                description: "Exactly the people this offer is for, as many as the offer's guests",
                items: {
                  type: "object",
                  properties: { memberId: { type: "string", description: "m1, m2, ..." }, note: { type: "string", description: "Why it suits them, one short sentence" } },
                  required: ["memberId", "note"],
                  additionalProperties: false,
                },
              },
            },
            required: ["offerId", "reason", "members"],
            additionalProperties: false,
          },
        },
        compromises: {
          type: "array",
          description: "Where the plan does not fully suit someone",
          items: { type: "object", properties: { memberId: { type: "string" }, note: { type: "string" } }, required: ["memberId", "note"], additionalProperties: false },
        },
      },
      required: ["title", "picks"],
      additionalProperties: false,
    },
  },
];

const FLIGHTS_SHOWN = 4;
const HOTELS_PER_ROOM_SIZE = 2;
const SEARCH_LIMITS = { flightsPerSlot: FLIGHTS_SHOWN, hotelsPerSlot: HOTELS_PER_ROOM_SIZE, activitiesPerDay: 0 } as const;

const perGuest = (offer: Offer): number => Math.ceil(offer.totalMinor / offer.guests);
const localReading = (dateTime: string): string => `${dateTime.slice(0, 10)} ${clockTime(dateTime) ?? ""}`.trim();

const flightView = (id: string, offer: FlightOffer) => ({
  id,
  route: offer.title,
  pricePerPerson: formatMinor(perGuest(offer), offer.currency),
  totalForGroup: formatMinor(offer.totalMinor, offer.currency),
  refundable: offer.refundable,
  legs: offer.legs.map((leg) => `${leg.direction}: ${leg.origin} to ${leg.destination}, departs ${localReading(leg.departAt)}, arrives ${localReading(leg.arriveAt)}`),
});

const hotelView = (id: string, offer: HotelOffer) => ({
  id,
  name: offer.title,
  room: offer.roomName,
  stars: offer.stars,
  roomIsFor: offer.guests,
  pricePerPerson: formatMinor(perGuest(offer), offer.currency),
  totalForRoom: formatMinor(offer.totalMinor, offer.currency),
  checkIn: offer.checkIn,
  checkOut: offer.checkOut,
  freeCancellationUntil: offer.freeCancellationUntil ?? "not listed",
});

const asJson = (value: unknown): string => JSON.stringify(value);
const problem = (message: string): string => asJson({ error: message });

/** The people the flights are for: everyone, or the ones the model listed. */
function resolveFlyers(listed: readonly string[] | undefined, roster: readonly RosterEntry[]): Result<readonly RosterEntry[], string> {
  if (listed === undefined) return ok(roster);
  const wanted = new Set(listed);
  const unknown = [...wanted].filter((alias) => !roster.some((entry) => entry.alias === alias));
  if (unknown.length > 0) return err(`These are not people in the group: ${unknown.join(", ")}. Use m1, m2, ... from the group list.`);
  return ok(roster.filter((entry) => wanted.has(entry.alias)));
}

async function searchTrip(env: ToolEnv, argumentsJson: string): Promise<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(argumentsJson);
  } catch {
    return problem("The arguments were not valid JSON.");
  }
  const parsed = searchArgs.safeParse(raw);
  if (!parsed.success) return problem(parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));

  const today = env.now.toISOString().slice(0, 10);
  const assessed = assessTripBrief({ fields: parsed.data, modelQuestions: [], today });
  if (assessed.status === "incomplete") return problem(assessed.problems.join(" ") || "The trip is missing something.");

  const everyone = env.roster;
  const flyers = resolveFlyers(parsed.data.flyers, everyone);
  if (!flyers.ok) return problem(flyers.error);
  const flying = flyers.value;

  const searched = await searchForTrip(env.deps.offers, assessed.trip, everyone.length, env.deps.searchOptions, flying.length);
  if (!searched.ok) return problem("The flight and hotel search is not answering right now. Tell the group and suggest trying again in a moment.");

  const kept = prefilterOffers({ offers: searched.value.offers, constraints: await env.constraints(), now: env.now, limits: SEARCH_LIMITS }).offers;
  const flights = kept.filter((offer): offer is FlightOffer => offer.kind === "flight");
  const hotels = kept.filter((offer): offer is HotelOffer => offer.kind === "hotel");

  const byAlias = new Map<string, Offer>();
  flights.forEach((offer, index) => byAlias.set(`F${index + 1}`, offer));
  hotels.forEach((offer, index) => byAlias.set(`H${index + 1}`, offer));
  env.session.trip = assessed.trip;
  env.session.flyerIds = flying.length === everyone.length ? null : flying.map((entry) => entry.member.id);
  env.session.searches = searched.value.searches;
  env.session.offersByAlias = byAlias;

  const notes: string[] = [];
  if (flights.length === 0 && flying.length > 0) notes.push("No flights were found for these dates and group size.");
  if (hotels.length === 0) notes.push("No hotels were found for these dates and group size.");
  if (searched.value.failures.length > 0) notes.push("Part of the search did not answer, so some options may be missing.");
  env.note("search_done", { trip: assessed.trip, offersFound: searched.value.offers.length, offersShown: kept.length, failures: searched.value.failures.length });

  return asJson({
    trip: assessed.trip,
    travellers: members(env).length,
    ...(flying.length < everyone.length && { flying: flying.map((entry) => entry.member.displayName), noFlightNeeded: everyone.filter((entry) => !flying.includes(entry)).map((entry) => entry.member.displayName) }),
    currency: kept[0]?.currency ?? "USD",
    flights: [...byAlias].filter(([, offer]) => offer.kind === "flight").map(([id, offer]) => flightView(id, offer as FlightOffer)),
    hotels: [...byAlias].filter(([, offer]) => offer.kind === "hotel").map(([id, offer]) => hotelView(id, offer as HotelOffer)),
    notes,
  });
}

/** Runs one tool the model asked for. Never throws: a failure is an answer the model can read and react to. */
export async function runTool(env: ToolEnv, name: string, argumentsJson: string): Promise<string> {
  try {
    switch (name) {
      case "search_trip":
        return await searchTrip(env, argumentsJson);
      case "propose_plan":
        return await proposePlan(env, argumentsJson);
      default:
        return problem(`There is no tool called ${name}.`);
    }
  } catch {
    return problem("That tool failed unexpectedly. You can try again or tell the group.");
  }
}
