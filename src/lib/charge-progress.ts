import type { PersonDto, PlanViewDto } from "@/domain/plan/view";

/** Whether this person has a card charge to wait for. Someone a friend covers in full has none: nothing was held for them. */
export const owesCharge = (person: Pick<PersonDto, "approvedMinor">): boolean => person.approvedMinor !== 0;

export interface ChargeProgress {
  readonly charged: number;
  readonly owing: number;
  /** Some cards have been charged and others have not. Before the first charge, and once all are in, it is not partial. */
  readonly partial: boolean;
}

/** How far the charging of a booked plan has got. */
export function chargeProgressOf(people: PlanViewDto["people"]): ChargeProgress {
  const owing = people.filter(owesCharge);
  const charged = owing.filter((person) => person.chargedMinor !== null).length;
  return { charged, owing: owing.length, partial: charged > 0 && charged < owing.length };
}
