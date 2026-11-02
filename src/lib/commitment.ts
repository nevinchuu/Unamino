import type { PlanStatus } from "@/domain/plan/statuses";

/**
 * Where one person stands on the step the plan is on, in one word for every screen. While the plan is being agreed
 * to, the ring turns green when they agree. Once everyone has agreed, every ring starts again from "not yet" and
 * turns green only when their own amount is approved and their card hold is placed.
 */
export type Commitment = "not_yet" | "agreed" | "approved";

/** The two steps a person acts on: agreeing to the plan (free), then approving their amount (a card hold). */
export type CommitmentStep = "agree" | "approve";

export interface CommitmentSource {
  /** They agreed to the plan. */
  readonly agreed: boolean;
  /** Their card hold is placed. */
  readonly held: boolean;
}

/** A plan still being agreed to asks for agreement; from approving onwards, what counts is the card hold. */
export const commitmentStepOf = (status: PlanStatus): CommitmentStep => (status === "draft" || status === "reviewing" ? "agree" : "approve");

export function commitmentOf(step: CommitmentStep, { agreed, held }: CommitmentSource): Commitment {
  if (step === "agree") return agreed ? "agreed" : "not_yet";
  return held ? "approved" : "not_yet";
}

/** Whether the ring is green: this person has done what the current step asks. */
export const isCommitted = (commitment: Commitment): boolean => commitment !== "not_yet";

const LABELS: Readonly<Record<Commitment, string>> = {
  not_yet: "Not yet",
  agreed: "Agreed",
  approved: "Approved",
};

export const commitmentLabel = (commitment: Commitment): string => LABELS[commitment];
