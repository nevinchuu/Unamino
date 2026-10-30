import { describe, expect, it } from "vitest";
import { applyCovers, coverProblem } from "./covers";
import { computeMemberShares } from "./shares";
import type { Cover, FxRateTable, LineItem, MemberShare } from "./types";

const fx: FxRateTable = { baseCurrency: "USD", source: "test-rates", ratesPerBase: { SGD: 1.35 } };
const everyone = ["leo", "sam", "maya"];

const item: LineItem = { id: "hotel", label: "Hotel", totalMinor: 30000, allocation: { type: "equal", memberIds: everyone } };

const sharesFor = (currencies: Record<string, string> = {}): readonly MemberShare[] => {
  const computed = computeMemberShares({ lineItems: [item], members: everyone.map((id) => ({ id, currency: currencies[id] ?? "USD" })), fx });
  if (!computed.ok) throw new Error(computed.error.message);
  return computed.value;
};

const covered = (covers: readonly Cover[], currencies?: Record<string, string>): readonly MemberShare[] => {
  const result = applyCovers(sharesFor(currencies), covers, fx);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const payment = (shares: readonly MemberShare[], id: string): number => shares.find((share) => share.memberId === id)?.shareMinor ?? -1;

describe("applyCovers", () => {
  it("changes nothing when nobody covers anybody", () => {
    const shares = sharesFor();
    expect(applyCovers(shares, [], fx)).toEqual({ ok: true, value: shares });
  });

  it("moves a part of one share onto the friend who covers it, and the total stays the same", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: 4000 }]);
    expect(payment(shares, "leo")).toBe(14000);
    expect(payment(shares, "sam")).toBe(6000);
    expect(payment(shares, "maya")).toBe(10000);
    expect(shares.reduce((total, share) => total + share.shareMinor, 0)).toBe(30000);
  });

  it("covers the whole share, leaving the covered person paying nothing", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null }]);
    expect(payment(shares, "leo")).toBe(20000);
    expect(payment(shares, "sam")).toBe(0);
  });

  it("never covers more than the person's own share", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: 99999 }]);
    expect(payment(shares, "sam")).toBe(0);
    expect(payment(shares, "leo")).toBe(20000);
  });

  it("lets two friends split the cost of one person, a fixed amount first and the rest to the whole-share cover", () => {
    const shares = covered([
      { sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null },
      { sponsorId: "maya", beneficiaryId: "sam", amountBaseMinor: 3000 },
    ]);
    expect(payment(shares, "maya")).toBe(13000);
    expect(payment(shares, "leo")).toBe(17000);
    expect(payment(shares, "sam")).toBe(0);
    expect(shares.reduce((total, share) => total + share.shareMinor, 0)).toBe(30000);
  });

  it("covers a percent of the person's own part, and the total stays the same", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 50 }]);
    expect(payment(shares, "leo")).toBe(15000);
    expect(payment(shares, "sam")).toBe(5000);
    expect(shares.reduce((total, share) => total + share.shareMinor, 0)).toBe(30000);
  });

  it("rounds a percent down to the cent, so the covered person pays the odd cent", () => {
    const odd = computeMemberShares({ lineItems: [{ ...item, totalMinor: 30001 }], members: everyone.map((id) => ({ id, currency: "USD" })), fx });
    if (!odd.ok) throw new Error(odd.error.message);
    const result = applyCovers(odd.value, [{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 50 }], fx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.reduce((total, share) => total + share.shareMinor, 0)).toBe(30001);
    const own = odd.value.find((share) => share.memberId === "sam")?.baseShareMinor ?? 0;
    expect(payment(result.value, "sam")).toBe(own - Math.floor(own / 2));
  });

  it("follows the price: a percent is of whatever the person's part is now", () => {
    const pricier = computeMemberShares({ lineItems: [{ ...item, totalMinor: 36000 }], members: everyone.map((id) => ({ id, currency: "USD" })), fx });
    if (!pricier.ok) throw new Error(pricier.error.message);
    const result = applyCovers(pricier.value, [{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 50 }], fx);
    if (!result.ok) throw new Error(result.error.message);
    expect(payment(result.value, "sam")).toBe(6000);
    expect(payment(result.value, "leo")).toBe(18000);
  });

  it("takes fixed amounts, then percents, then the whole-share cover gets what is left", () => {
    const shares = covered([
      { sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null },
      { sponsorId: "maya", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 50 },
    ]);
    expect(payment(shares, "maya")).toBe(15000);
    expect(payment(shares, "leo")).toBe(15000);
    expect(payment(shares, "sam")).toBe(0);
  });

  it("never covers more than is left when percents add up past a hundred", () => {
    const shares = covered([
      { sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 70 },
      { sponsorId: "maya", beneficiaryId: "sam", amountBaseMinor: null, sharePercent: 70 },
    ]);
    expect(payment(shares, "sam")).toBe(0);
    expect(payment(shares, "leo")).toBe(17000);
    expect(payment(shares, "maya")).toBe(13000);
  });

  it("records who moved what, on both sides", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: 4000 }]);
    expect(shares.find((share) => share.memberId === "leo")?.coverLines).toEqual([{ counterpartId: "sam", direction: "covering", baseMinor: 4000 }]);
    expect(shares.find((share) => share.memberId === "sam")?.coverLines).toEqual([{ counterpartId: "leo", direction: "covered_by", baseMinor: 4000 }]);
    expect(shares.find((share) => share.memberId === "maya")?.coverLines).toEqual([]);
  });

  it("keeps the person's own part unchanged so a later price change is measured from it", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: null }]);
    expect(shares.find((share) => share.memberId === "sam")?.baseShareMinor).toBe(10000);
  });

  it("converts what each card pays into that person's own currency", () => {
    const shares = covered([{ sponsorId: "leo", beneficiaryId: "sam", amountBaseMinor: 4000 }], { leo: "SGD" });
    expect(payment(shares, "leo")).toBe(18900);
    expect(payment(shares, "sam")).toBe(6000);
  });

  it("refuses a cover that names someone outside the plan", () => {
    expect(applyCovers(sharesFor(), [{ sponsorId: "leo", beneficiaryId: "stranger", amountBaseMinor: null }], fx)).toMatchObject({ ok: false, error: { code: "invalid_cover" } });
  });
});

describe("coverProblem", () => {
  const cover = (sponsorId: string, beneficiaryId: string, amountBaseMinor: number | null = null, sharePercent?: number): Cover => ({ sponsorId, beneficiaryId, amountBaseMinor, sharePercent });

  it("accepts a sensible set", () => {
    expect(coverProblem([cover("leo", "sam"), cover("maya", "sam", 1000)], everyone)).toBeNull();
  });

  it("refuses covering yourself", () => {
    expect(coverProblem([cover("leo", "leo")], everyone)).toMatch(/own share/);
  });

  it("refuses the same pair twice", () => {
    expect(coverProblem([cover("leo", "sam"), cover("leo", "sam", 500)], everyone)).toMatch(/already covering/);
  });

  it("refuses a chain, in either order", () => {
    expect(coverProblem([cover("leo", "sam"), cover("sam", "maya")], everyone)).toMatch(/cannot cover somebody else/);
    expect(coverProblem([cover("sam", "maya"), cover("leo", "sam")], everyone)).toMatch(/cannot cover somebody else/);
  });

  it("refuses an amount that is not a positive whole number", () => {
    expect(coverProblem([cover("leo", "sam", 0)], everyone)).toMatch(/more than zero/);
    expect(coverProblem([cover("leo", "sam", 10.5)], everyone)).toMatch(/more than zero/);
  });

  it("refuses people who are not in the plan", () => {
    expect(coverProblem([cover("leo", "stranger")], everyone)).toMatch(/part of this plan/);
  });

  it("accepts a whole percent from 1 to 99 and refuses anything else", () => {
    expect(coverProblem([cover("leo", "sam", null, 50)], everyone)).toBeNull();
    for (const percent of [0, 100, -5, 12.5, Number.NaN]) {
      expect(coverProblem([cover("leo", "sam", null, percent)], everyone)).toMatch(/whole percent/);
    }
  });

  it("refuses a cover that is both an amount and a percent", () => {
    expect(coverProblem([cover("leo", "sam", 1000, 50)], everyone)).toMatch(/not both/);
  });
});
