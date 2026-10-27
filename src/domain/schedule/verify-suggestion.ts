import { err, ok, type Result } from "@/lib/result";
import type { ConstraintSet } from "@/domain/constraints/schema";
import { isOpenDuring } from "./opening-hours";
import type { Suggestion } from "./suggestion-schema";
import { formatMinutes, toMinutes, weekdayOf } from "./time";
import type { FreeGap } from "./types";
import { namesMatch, type VenueFacts, type VenueLookup } from "./venue";

export type RejectionCode =
  | "unknown_gap"
  | "outside_gap"
  | "member_conflict"
  | "overlaps_other"
  | "not_found"
  | "name_mismatch"
  | "closed_permanently"
  | "closed_temporarily"
  | "no_hours"
  | "closed_then"
  | "duplicate_venue"
  | "lookup_unavailable";

export interface Rejection {
  readonly suggestion: Suggestion;
  readonly code: RejectionCode;
  /** Plain words, safe to show and to feed back to the planner. */
  readonly message: string;
}

/** A suggestion whose place exists and is open at the planned time. The venue facts come from the lookup. */
export interface VerifiedSuggestion {
  readonly gapId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMinutes: number;
  readonly category: string;
  /** The planner's reason. The only model-written text shown. */
  readonly why: string;
  readonly venue: VenueFacts;
  readonly checkedAt: string;
}

export interface TakenSlots {
  readonly placeIds: ReadonlySet<string>;
  readonly windows: readonly { readonly date: string; readonly start: number; readonly end: number }[];
}

export interface VerifyContext {
  readonly gaps: readonly FreeGap[];
  readonly memberIds: readonly string[];
  readonly constraints: ConstraintSet;
  readonly city: string;
  readonly lookup: VenueLookup;
  readonly taken: TakenSlots;
  readonly now: Date;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const reject = (suggestion: Suggestion, code: RejectionCode, message: string): Result<never, Rejection> =>
  err({ suggestion, code, message });

/** The cheap checks that need no lookup: the slot exists, fits the gap, and nobody opted out of it. */
function checkSlot(suggestion: Suggestion, ctx: VerifyContext, start: number, end: number): Rejection | null {
  const gap = ctx.gaps.find((candidate) => candidate.id === suggestion.gapId);
  if (!gap) return { suggestion, code: "unknown_gap", message: `There is no free gap called ${suggestion.gapId}` };
  if (start < toMinutes(gap.startTime) || end > toMinutes(gap.endTime)) {
    return { suggestion, code: "outside_gap", message: `${suggestion.startTime} for ${suggestion.durationMinutes} minutes does not fit the free time ${gap.startTime} to ${gap.endTime} on ${gap.date}` };
  }
  const objector = ctx.memberIds.find((id) => ctx.constraints[id]?.skipActivityCategories?.includes(suggestion.category));
  if (objector) return { suggestion, code: "member_conflict", message: `${objector} does not want ${suggestion.category} activities` };
  const clash = ctx.taken.windows.find((window) => window.date === gap.date && start < window.end && window.start < end);
  if (clash) return { suggestion, code: "overlaps_other", message: `${suggestion.startTime} overlaps another suggestion that day` };
  return null;
}

/** The checks on what the lookup returned: the right place, still trading, and open at that time. */
function checkVenue(suggestion: Suggestion, venue: VenueFacts, date: string, start: number, end: number, ctx: VerifyContext): Rejection | null {
  if (venue.businessStatus === "closed_permanently") return { suggestion, code: "closed_permanently", message: `${venue.name} is permanently closed` };
  if (venue.businessStatus === "closed_temporarily") return { suggestion, code: "closed_temporarily", message: `${venue.name} is temporarily closed` };
  if (ctx.taken.placeIds.has(venue.placeId)) return { suggestion, code: "duplicate_venue", message: `${venue.name} is already suggested` };
  if (venue.hours === null) return { suggestion, code: "no_hours", message: `No opening hours are listed for ${venue.name}, so it cannot be confirmed open` };
  if (!isOpenDuring(venue.hours, { date, startMinute: start, endMinute: end })) {
    return { suggestion, code: "closed_then", message: `${venue.name} is not open ${suggestion.startTime} to ${formatMinutes(end)} on ${WEEKDAYS[weekdayOf(date)]}s` };
  }
  return null;
}

/** Checks one suggestion against the schedule, the group and the real world. */
export async function verifySuggestion(suggestion: Suggestion, ctx: VerifyContext): Promise<Result<VerifiedSuggestion, Rejection>> {
  const start = toMinutes(suggestion.startTime);
  const end = start + suggestion.durationMinutes;
  const slotProblem = checkSlot(suggestion, ctx, start, end);
  if (slotProblem) return err(slotProblem);
  const date = (ctx.gaps.find((gap) => gap.id === suggestion.gapId) as FreeGap).date; // checkSlot found it

  const found = await ctx.lookup.search({ name: suggestion.venueName, city: ctx.city });
  if (!found.ok) return reject(suggestion, "lookup_unavailable", `Could not check ${suggestion.venueName}: ${found.error.message}`);
  if (found.value.length === 0) return reject(suggestion, "not_found", `No place called ${suggestion.venueName} was found in ${ctx.city}`);

  const venue = found.value.find((candidate) => namesMatch(suggestion.venueName, candidate.name));
  if (!venue) return reject(suggestion, "name_mismatch", `The closest match to ${suggestion.venueName} was ${found.value[0].name}, which is a different place`);

  const venueProblem = checkVenue(suggestion, venue, date, start, end, ctx);
  if (venueProblem) return err(venueProblem);

  return ok({
    gapId: suggestion.gapId,
    date,
    startTime: suggestion.startTime,
    endTime: formatMinutes(end),
    durationMinutes: suggestion.durationMinutes,
    category: suggestion.category,
    why: suggestion.why,
    venue,
    checkedAt: ctx.now.toISOString(),
  });
}
