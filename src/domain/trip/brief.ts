import type { TripFields } from "./brief-schema";

const MAX_TRIP_DAYS = 30;
const MAX_DAYS_AHEAD = 365;
const MAX_QUESTIONS = 3;
const MS_PER_DAY = 86_400_000;

/** A trip with everything a search needs. */
export interface CompleteTrip {
  readonly destinationCity: string;
  readonly destinationCountry: string;
  readonly destinationAirport: string;
  readonly originAirport: string;
  readonly departDate: string;
  readonly returnDate: string;
}

export type MissingField = "destination" | "origin" | "departDate" | "returnDate";

export type BriefAssessment =
  | { readonly status: "complete"; readonly trip: CompleteTrip }
  | {
      readonly status: "incomplete";
      readonly missing: readonly MissingField[];
      /** Things that were said but cannot be right, such as a date in the past. */
      readonly problems: readonly string[];
      /** What to ask the group, in plain words. Never empty. */
      readonly questions: readonly string[];
    };

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

function missingFields(fields: TripFields): MissingField[] {
  const missing: MissingField[] = [];
  if (!fields.destinationCity || !fields.destinationCountry || !fields.destinationAirport) missing.push("destination");
  if (!fields.originAirport) missing.push("origin");
  if (!fields.departDate) missing.push("departDate");
  if (!fields.returnDate) missing.push("returnDate");
  return missing;
}

/** Dates that were given but cannot be searched, said as a question the group can answer. */
function dateProblems(fields: TripFields, today: string): string[] {
  const { departDate, returnDate } = fields;
  const problems: string[] = [];
  if (departDate && departDate < today) problems.push(`The departure date ${departDate} has already passed. Which date did you mean?`);
  if (returnDate && returnDate < today) problems.push(`The return date ${returnDate} has already passed. Which date did you mean?`);
  if (departDate && returnDate && returnDate < departDate) problems.push(`The return date ${returnDate} is before the departure date ${departDate}. Which dates did you mean?`);
  if (departDate && returnDate && returnDate >= departDate && daysBetween(departDate, returnDate) > MAX_TRIP_DAYS) {
    problems.push(`${departDate} to ${returnDate} is longer than ${MAX_TRIP_DAYS} days. Is that right?`);
  }
  if (departDate && daysBetween(today, departDate) > MAX_DAYS_AHEAD) problems.push(`${departDate} is more than a year away. Is that right?`);
  return problems;
}

const QUESTION_FOR: Record<MissingField, string> = {
  destination: "Where would you like to go?",
  origin: "Which city or airport will everyone fly from?",
  departDate: "What date do you want to leave?",
  returnDate: "What date do you want to come back?",
};

/** A question for each gap, used when the model asked none. Both dates missing become one question. */
function templateQuestions(missing: readonly MissingField[]): string[] {
  const bothDates = missing.includes("departDate") && missing.includes("returnDate");
  return missing
    .filter((field) => !(bothDates && field === "returnDate"))
    .map((field) => (bothDates && field === "departDate" ? "What dates would you like to travel, leaving and coming back?" : QUESTION_FOR[field]));
}

export interface AssessInput {
  readonly fields: TripFields;
  /** What the model asked, if anything. Used when the gaps are ordinary; code adds its own for impossible dates. */
  readonly modelQuestions: readonly string[];
  /** Today's date, "YYYY-MM-DD", in the group's time. */
  readonly today: string;
}

/**
 * Decides whether the trip is known well enough to search, and if not, what to ask. The model reads the chat,
 * but this is code: a date in the past or a missing airport is caught here, not trusted to the model.
 */
export function assessTripBrief({ fields, modelQuestions, today }: AssessInput): BriefAssessment {
  const missing = missingFields(fields);
  const problems = dateProblems(fields, today);

  if (missing.length === 0 && problems.length === 0) {
    return {
      status: "complete",
      trip: {
        destinationCity: fields.destinationCity as string,
        destinationCountry: fields.destinationCountry as string,
        destinationAirport: fields.destinationAirport as string,
        originAirport: fields.originAirport as string,
        departDate: fields.departDate as string,
        returnDate: fields.returnDate as string,
      },
    };
  }

  const asked = modelQuestions.length > 0 ? modelQuestions : templateQuestions(missing);
  const questions = [...new Set([...problems, ...asked])].slice(0, MAX_QUESTIONS);
  return { status: "incomplete", missing, problems, questions };
}
