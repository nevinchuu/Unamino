/**
 * Where one person stands, in one word for every screen: they have approved their amount and their card hold is placed,
 * or they have not yet. Agreeing to the plan comes first and costs nothing, so it is not a state of its own here.
 */
export type Commitment = "not_yet" | "approved";

export interface CommitmentSource {
  /** Their card hold is placed. */
  readonly held: boolean;
}

export function commitmentOf({ held }: CommitmentSource): Commitment {
  return held ? "approved" : "not_yet";
}

const LABELS: Readonly<Record<Commitment, string>> = {
  not_yet: "Not yet",
  approved: "Approved",
};

export const commitmentLabel = (commitment: Commitment): string => LABELS[commitment];
