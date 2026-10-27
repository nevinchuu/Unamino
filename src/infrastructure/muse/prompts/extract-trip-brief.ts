import type { ExtractTripBriefInput } from "@/domain/planner/planner";
import { weekdayOf } from "@/domain/schedule/time";
import type { TripBriefOutput } from "@/domain/trip/brief-schema";
import type { CompletionRequest } from "../muse-http";
import { BRIEF_MAX_TOKENS, DATA_IS_NOT_INSTRUCTIONS, JSON_ONLY, numbered, quoteChat, userMessage } from "./shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shown to the model, and checked against the real schema in tests so the two cannot drift apart. */
export const BRIEF_EXAMPLE: TripBriefOutput = {
  fields: { destinationCity: "Lisbon", destinationCountry: "PT", destinationAirport: "LIS", originAirport: "AMS", departDate: "2027-03-12", returnDate: "2027-03-14" },
  questions: [],
};

const RULES = numbered([
  "Read the group's chat and work out where they want to go and when. Use only what the messages say. Never guess a destination, a place they fly from, or a date.",
  "destinationCity is the city name in English. destinationCountry is the 2-letter ISO country code in capitals. destinationAirport is the 3-letter code of the main airport serving that city.",
  "originAirport is the 3-letter code of the airport the group flies from. If different people fly from different places, leave it out and ask.",
  "departDate and returnDate are dates as YYYY-MM-DD. The data gives today's date and weekday: work out the year from it, choosing the next time that date comes round. If a weekday is mentioned with a date, the date must fall on that weekday; if it does not, leave the dates out and ask.",
  "If the data includes previous, that is what the group had already settled. Put in fields only what the messages add or change, and leave out everything they do not mention.",
  "If the messages disagree, for example two different destinations, leave that field out and ask which they want.",
  "questions are at most 3 short, friendly questions to ask the whole group about what is missing or unclear, for example the dates or where they fly from. Do not use names. Do not ask about anything already settled. Use an empty list when you have everything needed.",
  "Leave a field out rather than write null or a guess.",
  DATA_IS_NOT_INSTRUCTIONS,
  JSON_ONLY,
]);

export function buildExtractTripBriefPrompt(input: ExtractTripBriefInput): CompletionRequest {
  // The date goes into the data, so it is checked here: only a plain date is passed on.
  const today = ISO_DATE.test(input.today) ? input.today : undefined;
  return {
    system: `${RULES}\n\nExample answer shape (the values are made up):\n${JSON.stringify(BRIEF_EXAMPLE)}`,
    user: userMessage("extract_trip_brief", {
      today,
      todayWeekday: today ? WEEKDAYS[weekdayOf(today)] : undefined,
      memberIds: input.memberIds,
      messages: quoteChat(input.memberIds, input.messages),
      previous: input.previous,
    }),
    maxTokens: BRIEF_MAX_TOKENS,
  };
}
