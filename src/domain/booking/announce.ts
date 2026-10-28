/** Why a booking was given up on. */
export type BookingFailureKind = "price" | "unavailable" | "details" | "hold" | "deadline" | "stuck" | "other";

const ENDED = "so nothing was booked or charged and every card hold was let go.";

/**
 * What the group is told when booking fails. Fixed lines: a supplier's own words never go into the chat, because
 * they can name internals. The first part says what went wrong, the rest is the same every time.
 */
export const BOOKING_FAILED_LINES: Readonly<Record<BookingFailureKind, string>> = {
  price: `A price went up while booking, ${ENDED} Mention @trippy to plan again.`,
  unavailable: `A flight or hotel was no longer available, ${ENDED} Mention @trippy to plan again.`,
  details: `Someone's traveller details were missing, ${ENDED} Mention @trippy to plan again.`,
  hold: `A card hold was no longer valid, ${ENDED} Mention @trippy to plan again.`,
  deadline: `The plan ran out of time while booking, ${ENDED} Mention @trippy to plan again.`,
  stuck: `Booking took too long, ${ENDED} Mention @trippy to plan again.`,
  other: `Booking did not go through, ${ENDED} Mention @trippy to plan again.`,
};
