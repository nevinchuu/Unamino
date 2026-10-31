import { isRetryable, shortName, type BookingFailureKind, type FailureCause, type PartKind, type UndonePart } from "./failure";

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
  demo: "The final fare check failed (demo: we made it fail on purpose).",
  other: "Booking did not go through.",
};

/** Why one named hotel or flight could not be booked, in words that fit "because ...". */
const REASONS: Readonly<Partial<Record<BookingFailureKind, string>>> = {
  price: "its price went up",
  unavailable: "it is no longer available",
  rejected: "the booking partner refused it",
  temporary: "the booking partner could not be reached just now",
};

/** What the booking partner's answer said, when it said more than "no". Says whose side the problem is on where that matters. */
const CAUSES: Readonly<Record<FailureCause, string>> = {
  request_not_accepted: "the booking partner would not accept the request, often because a traveller detail was not in the form it needs",
  access_refused: "our own connection to the booking partner was refused, which is a problem on our side and not with your card or details",
  booking_declined: "the booking partner declined it, and asking again would get the same answer",
  meal_plan_changed: "the hotel changed the meal plan on that room, so it is no longer what the group agreed to",
  not_confirmed: "the booking partner did not confirm it",
  answer_unreadable: "the booking partner's answer could not be understood, so the price could not be checked",
  no_answer: "the booking partner did not answer in time",
  partner_busy: "the booking partner was too busy to take it just now",
  partner_error: "the booking partner had an error on its side",
};

/** What the words need of a failure: the saved record has more (listing ids, prices) that no sentence uses. */
interface Failure {
  readonly reason: BookingFailureKind;
  readonly cause?: FailureCause | null;
  readonly part: { readonly kind: PartKind; readonly title: string } | null;
  readonly undone: readonly UndonePart[];
}

/** Each part once, with how many bookings it was when there were several (a hotel booked room by room). */
const namesOf = (parts: readonly UndonePart[]): readonly string[] => {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const name = `${part.kind} ${shortName(part.title)}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${name} (${count} bookings)` : name));
};

const joinNames = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Which part failed and why, as one sentence: the same words in the chat and on the plan screen. */
export function failureSummary(failure: Pick<Failure, "reason" | "cause" | "part">): string {
  if (!failure.part) return HEADLINES[failure.reason];
  const because = (failure.cause ? CAUSES[failure.cause] : REASONS[failure.reason]) ?? "something went wrong";
  return `The ${failure.part.kind} ${shortName(failure.part.title)} could not be booked because ${because}.`;
}

/** What had been booked and was cancelled again, or null when nothing had been. */
export function undoneSentence(undone: readonly UndonePart[]): string | null {
  const names = namesOf(undone);
  return names.length > 0 ? `The ${joinNames(names)} had already been booked and ${names.length === 1 ? "was" : "were"} cancelled.` : null;
}

/**
 * What the group is told when booking fails: which part could not be booked and why, what had been booked and was
 * cancelled, and that nobody is charged. A supplier's own words never go into the chat, because they can name
 * internals, so the reason is one of a fixed few and the names are the ones the app already shows.
 */
export function bookingFailedLine(failure: Failure): string {
  const undone = undoneSentence(failure.undone);
  const next = isRetryable(failure.reason) ? "Mention @trippy to plan again, or to try the same plan once more." : "Mention @trippy to plan again.";
  return [failureSummary(failure), undone, `Nothing was charged and every card hold was let go. ${next}`].filter((part) => part !== null).join(" ");
}
