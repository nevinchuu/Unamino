import { minorUnitExponent } from "@/domain/money/currency";
import type { CoverDto, PersonDto } from "@/domain/plan/view";
import type { CoverChange } from "@/server/cover-actions";

export type CoverMode = "all" | "half" | "custom";

/** The share of a friend's part that "Half" covers. */
export const HALF_PERCENT = 50;

export interface CoverTarget {
  readonly person: PersonDto;
  /** Why this friend cannot be covered right now, or null when they can. */
  readonly blockedReason: string | null;
  /** What other friends already cover of them, at today's prices. */
  readonly othersCoverMinor: number;
}

/**
 * Who the viewer can cover and, for those they cannot, why. Nobody is covered and covering at once, so a friend who
 * covers someone is out, and if the viewer is being covered nobody can be.
 */
export function coverTargets(people: readonly PersonDto[], covers: readonly CoverDto[]): readonly CoverTarget[] {
  const me = people.find((person) => person.isMe);
  const viewerIsCovered = me ? covers.some((cover) => cover.beneficiaryId === me.id) : false;
  return people
    .filter((person) => !person.isMe)
    .map((person) => {
      const covering = covers.find((cover) => cover.sponsorId === person.id);
      const blockedReason =
        viewerIsCovered ? "You're being covered, so you can't cover anyone"
        : covering ? `Already covering ${covering.beneficiaryName}`
        : person.ownPartMinor === null ? "Their price isn't ready yet"
        : null;
      const othersCoverMinor = covers.filter((cover) => cover.beneficiaryId === person.id && !(me && cover.sponsorId === me.id)).reduce((sum, cover) => sum + cover.amountMinor, 0);
      return { person, blockedReason, othersCoverMinor };
    });
}

/** What the viewer would pay for this friend, at today's prices, never more than is left of their part. */
export function coverAmount(mode: CoverMode, ownPartMinor: number, othersCoverMinor: number, customMinor: number | null): number {
  const left = Math.max(0, ownPartMinor - othersCoverMinor);
  if (mode === "all") return left;
  if (mode === "half") return Math.min(left, Math.floor((ownPartMinor * HALF_PERCENT) / 100));
  return Math.min(left, customMinor ?? 0);
}

/** The request to send for what the person picked, or null while a custom amount is missing or not usable. */
export function coverChangeFor(mode: CoverMode, customMinor: number | null): CoverChange | null {
  if (mode === "all") return { kind: "all" };
  if (mode === "half") return { kind: "percent", percent: HALF_PERCENT };
  return customMinor === null ? null : { kind: "amount", amountMinor: customMinor };
}

/** Dollars and cents as typed ("12", "12.5", "$12.50") to minor units, or null when it is not an amount above zero. */
export function parseMoney(text: string, currency: string): number | null {
  const exponent = minorUnitExponent(currency) ?? 2;
  const cleaned = text.trim().replace(/^[$€£¥\s]+/, "").replace(/,/g, "");
  const pattern = new RegExp(`^\\d+(\\.\\d{0,${exponent}})?$`);
  if (!pattern.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 10 ** exponent);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** What the notice says once the cover is in. */
export function coverNotice(change: CoverChange, friend: string, amountText: string): string {
  switch (change.kind) {
    case "all":
      return `You're covering ${friend}'s whole share.`;
    case "percent":
      return change.percent === HALF_PERCENT ? `You're covering half of ${friend}'s share.` : `You're covering ${change.percent}% of ${friend}'s share.`;
    case "amount":
      return `You're covering ${amountText} of ${friend}'s share.`;
    case "stop":
      return `You're no longer covering ${friend}'s share.`;
  }
}
