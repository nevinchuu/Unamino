import { err, ok, type Result } from "@/lib/result";
import { convertMinor } from "./fx";
import type { Cover, CoverLine, FxRateTable, MemberShare, SplitError } from "./types";

const invalid = (message: string): Result<never, SplitError> => err({ code: "invalid_cover", message });

/** The percent of the beneficiary's own part this cover pays, or null when it is an amount or the whole share. */
const percentOf = (cover: Cover): number | null => cover.sharePercent ?? null;
const isShare = (cover: Cover): boolean => percentOf(cover) !== null;

/**
 * Why this set of covers cannot stand, in plain words, or null if it can. A cover is between two people in the plan,
 * never from a person to themself, once per pair, and never in a chain: someone being covered cannot also be covering,
 * because then whose card pays for what would depend on the order.
 */
export function coverProblem(covers: readonly Cover[], memberIds: readonly string[]): string | null {
  const known = new Set(memberIds);
  const beneficiaries = new Set(covers.map((cover) => cover.beneficiaryId));
  const pairs = new Set<string>();
  for (const cover of covers) {
    if (!known.has(cover.sponsorId) || !known.has(cover.beneficiaryId)) return "Both people must be part of this plan";
    if (cover.sponsorId === cover.beneficiaryId) return "Nobody can cover their own share";
    if (cover.amountBaseMinor !== null && !(Number.isSafeInteger(cover.amountBaseMinor) && cover.amountBaseMinor > 0)) return "A covered amount must be more than zero";
    if (isShare(cover) && cover.amountBaseMinor !== null) return "A cover is an amount or a share, not both";
    const percent = percentOf(cover);
    if (percent !== null && !(Number.isInteger(percent) && percent >= 1 && percent <= 99)) return "A covered share must be a whole percent from 1 to 99";
    const pair = `${cover.sponsorId}>${cover.beneficiaryId}`;
    if (pairs.has(pair)) return "That person is already covering them";
    pairs.add(pair);
    if (beneficiaries.has(cover.sponsorId)) return "Someone who is being covered cannot cover somebody else";
  }
  return null;
}

/**
 * Moves money between cards after the split. Each beneficiary's own part (what they take part in) is the most that can
 * be covered, so the trip total never changes: whatever one card stops paying another starts paying. A fixed amount is
 * taken first, in the order the covers were made, then shares (a percent of their own part, rounded down to the cent,
 * so it follows the price); a cover of the whole share takes whatever is left, so "cover all of Sam" still means all
 * of Sam when another friend has put in part of it.
 */
export function applyCovers(shares: readonly MemberShare[], covers: readonly Cover[], fx: FxRateTable): Result<readonly MemberShare[], SplitError> {
  if (covers.length === 0) return ok(shares);
  const problem = coverProblem(covers, shares.map((share) => share.memberId));
  if (problem) return invalid(problem);

  const left = new Map(shares.map((share) => [share.memberId, share.baseShareMinor]));
  const pays = new Map(shares.map((share) => [share.memberId, share.baseShareMinor]));
  const lines = new Map<string, CoverLine[]>(shares.map((share) => [share.memberId, []]));

  const own = new Map(shares.map((share) => [share.memberId, share.baseShareMinor]));
  const ordered = [
    ...covers.filter((cover) => cover.amountBaseMinor !== null),
    ...covers.filter(isShare),
    ...covers.filter((cover) => cover.amountBaseMinor === null && !isShare(cover)),
  ];
  for (const cover of ordered) {
    const available = left.get(cover.beneficiaryId) ?? 0;
    const percent = percentOf(cover);
    const wanted = percent === null ? cover.amountBaseMinor : Math.floor(((own.get(cover.beneficiaryId) ?? 0) * percent) / 100);
    const amount = wanted === null ? available : Math.min(wanted, available);
    if (amount <= 0) continue;
    left.set(cover.beneficiaryId, available - amount);
    pays.set(cover.beneficiaryId, (pays.get(cover.beneficiaryId) ?? 0) - amount);
    pays.set(cover.sponsorId, (pays.get(cover.sponsorId) ?? 0) + amount);
    lines.get(cover.beneficiaryId)?.push({ counterpartId: cover.sponsorId, direction: "covered_by", baseMinor: amount });
    lines.get(cover.sponsorId)?.push({ counterpartId: cover.beneficiaryId, direction: "covering", baseMinor: amount });
  }

  const covered: MemberShare[] = [];
  for (const share of shares) {
    const baseToPay = pays.get(share.memberId) ?? share.baseShareMinor;
    const converted = convertMinor(baseToPay, fx.baseCurrency, share.currency, fx);
    if (!converted.ok) return converted;
    covered.push({ ...share, coverLines: lines.get(share.memberId) ?? [], shareMinor: converted.value });
  }
  return ok(covered);
}
