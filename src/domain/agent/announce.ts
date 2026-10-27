import { formatMinor } from "@/lib/format-money";
import type { ConstraintViolation } from "@/domain/planner/check-constraints";
import type { MemberShare } from "@/domain/split/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { CompleteTrip } from "@/domain/trip/brief";
import { nameMembers } from "./aliasing-planner";

/**
 * What the agent says in the chat. These are written here, from real numbers, not by the model: the model's
 * only words that reach the group are its questions and its short reasons for each pick.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-12-11" as "Fri 11 Dec". */
export function shortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

interface Person {
  readonly id: string;
  readonly displayName: string;
}

export const questionsMessage = (questions: readonly string[]): string =>
  questions.length === 1 ? `I need one more thing before I can plan: ${questions[0]}` : `I need a bit more information before I can plan:\n${questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}\nReply to this message with the answers.`;

export interface PlanAnnouncementInput {
  readonly trip: CompleteTrip;
  readonly members: readonly Person[];
  readonly shares: readonly MemberShare[];
  readonly totalMinor: number;
  readonly currency: string;
  readonly violations: readonly ConstraintViolation[];
  readonly replacedAnotherPlan: boolean;
}

export function planAnnouncement(input: PlanAnnouncementInput): string {
  const { trip, members, shares, totalMinor, currency, violations, replacedAnotherPlan } = input;
  const nameOf = new Map(members.map((member) => [member.id, member.displayName]));
  const lines = [
    `${replacedAnotherPlan ? "Here is an updated plan" : "Here is a plan"} for ${trip.destinationCity}, ${shortDate(trip.departDate)} to ${shortDate(trip.returnDate)}, for ${members.length} ${members.length === 1 ? "person" : "people"}. The trip costs ${formatMinor(totalMinor, currency)} in total.`,
    ...shares.map((share) => `• ${nameOf.get(share.memberId) ?? "Someone"}: ${formatMinor(share.shareMinor, share.currency)}`),
  ];
  if (violations.length > 0) lines.push("", "Not fully served:", ...violations.map((violation) => `• ${nameMembers(violation.message, members)}`));
  lines.push("", replacedAnotherPlan ? "The earlier plan is cancelled, so everyone needs to look at this one." : "Please look at the plan and agree or decline.", "Nothing is charged until everyone has agreed and each person has approved their own amount.");
  return lines.join("\n");
}

export function statusMessage(status: PlanStatus, agreedCount: number, headcount: number): string {
  switch (status) {
    case "draft":
    case "reviewing":
      return `Nothing has changed since I made the plan, so I have not made a new one. ${agreedCount} of ${headcount} have agreed to it so far. If something is different, say what in the chat and mention me again.`;
    case "approving":
      return "Everyone has agreed to the plan, and nothing has changed since. Now each person needs to approve their own amount.";
    case "held":
    case "booking":
      return "Everyone has approved and the trip is being booked now.";
    case "booked":
    case "captured":
      return "The trip is booked. Nothing has changed since.";
    case "expired":
      return "The last plan has ended. Mention me and I will make a new one.";
  }
}

const listKinds = (kinds: readonly string[]): string => kinds.join(" and ");

/** A search that a plan cannot do without did not answer. Says so, instead of letting the planner fail for a reason it cannot explain. */
export const searchIncomplete = (kinds: readonly string[]): string => `I could not get ${listKinds(kinds)} prices just now. Please try again in a moment.`;

export const nothingFound = (kinds: readonly string[]): string => `I found no ${listKinds(kinds)} for those dates and that group size. Try different dates, then mention me again.`;

/** Plain messages for when a run cannot finish. They say what to do, never what went wrong inside. */
export const MESSAGES = {
  busy: "I am still working on the last request. I will post here when it is done.",
  planner_unavailable: "I could not reach my assistant just now. Please try again in a moment.",
  invalid_output: "I could not make sense of that. Could you say it a different way and mention me again?",
  search_unavailable: "I could not search for flights and hotels just now. Please try again in a moment.",
  no_valid_plan: "I could not find a plan that works with what is available. Try different dates or relax a limit, then mention me again.",
  prices_expired: "The prices I found have already run out. Please mention me again.",
  booking_started: "Booking has already started for the current plan, so it can no longer be changed.",
  trip_booked: "The trip is already booked, so the plan can no longer be changed.",
  conflict: "Someone else just changed the plan. Please mention me again.",
  no_exchange_rate: "I cannot price this for everyone yet because I have no exchange rate for one of the currencies.",
  failed: "Something went wrong on my side. Please try again.",
} as const;
