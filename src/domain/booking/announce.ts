import { isRetryable, shortName, type BookingFailureKind, type BookingFailureRecord, type UndonePart } from "./failure";

export type { BookingFailureKind } from "./failure";

/** What goes wrong when no single hotel or flight is to blame. */
const HEADLINES: Readonly<Record<BookingFailureKind, string>> = {
  price: "A price went up while booking.",
  unavailable: "A flight or hotel was no longer available.",
  rejected: "The booking partner refused a booking.",
  temporary: "The booking partner could not be reached.",
  details: "Someone's traveller details were missing.",
  hold: "A card hold was no longer valid.",
  deadline: "The plan ran out of time while booking.",
  stuck: "Booking took too long.",
  other: "Booking did not go through.",
};

/** Why one named hotel or flight could not be booked, in words that fit "because ...". */
const REASONS: Readonly<Partial<Record<BookingFailureKind, string>>> = {
  price: "its price went up",
  unavailable: "it is no longer available",
  rejected: "the booking partner refused it",
  temporary: "the booking partner could not be reached just now",
};

const listOf = (parts: readonly UndonePart[]): string => {
  const names = parts.map((part) => `${part.kind} ${shortName(part.title)}`);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/**
 * What the group is told when booking fails: which part could not be booked and why, what had been booked and was
 * cancelled, and that nobody is charged. A supplier's own words never go into the chat, because they can name
 * internals, so the reason is one of a fixed few and the names are the ones the app already shows.
 */
export function bookingFailedLine(failure: Pick<BookingFailureRecord, "reason" | "part" | "undone">): string {
  const what = failure.part ? `The ${failure.part.kind} ${shortName(failure.part.title)} could not be booked because ${REASONS[failure.reason] ?? "something went wrong"}.` : HEADLINES[failure.reason];
  const undone = failure.undone.length > 0 ? ` The ${listOf(failure.undone)} had already been booked and ${failure.undone.length === 1 ? "was" : "were"} cancelled.` : "";
  const next = isRetryable(failure.reason) ? "Mention @trippy to plan again, or to try the same plan once more." : "Mention @trippy to plan again.";
  return `${what}${undone} Nothing was charged and every card hold was let go. ${next}`;
}
