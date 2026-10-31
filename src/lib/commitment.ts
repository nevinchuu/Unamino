/**
 * How far one person has got towards committing, in one set of words for every screen. "In" is the one that matters:
 * their card hold is placed, so the trip can be booked once everyone else is in too.
 */
export type Commitment = "not_yet" | "agreed" | "approved" | "in";

export interface CommitmentSource {
  readonly agreed: boolean;
  /** They approved an amount; their card may still be to add. */
  readonly approved: boolean;
  readonly held: boolean;
}

/** The furthest step the person has completed. */
export function commitmentOf({ agreed, approved, held }: CommitmentSource): Commitment {
  if (held) return "in";
  if (approved) return "approved";
  if (agreed) return "agreed";
  return "not_yet";
}

const LABELS: Readonly<Record<Commitment, string>> = {
  not_yet: "Not yet",
  agreed: "Agreed",
  approved: "Approved",
  in: "In",
};

/** What to say for a person's state. `cardToAdd` is for someone who approved when a real card still has to be added. */
export function commitmentLabel(commitment: Commitment, cardToAdd = false): string {
  return commitment === "approved" && cardToAdd ? "Approved, card to add" : LABELS[commitment];
}
