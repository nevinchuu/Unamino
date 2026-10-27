import { describe, expect, it } from "vitest";
import { minorUnitExponent } from "@/domain/money/currency";
import { formatMinor } from "@/lib/format-money";
import { allocateLineItem } from "./allocate";
import { convertMinor, rateBetween } from "./fx";
import { computeMemberShares, totalOfLineItems } from "./shares";
import type { FxRateTable, LineItem } from "./types";

const fx: FxRateTable = {
  baseCurrency: "USD",
  source: "test-rates",
  ratesPerBase: { SGD: 1.35, JPY: 150 },
};

const equal = (id: string, totalMinor: number, memberIds: string[]): LineItem => ({
  id,
  label: id,
  totalMinor,
  allocation: { type: "equal", memberIds },
});

describe("minorUnitExponent", () => {
  it("knows two-decimal and zero-decimal currencies", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
  });

  it("rejects malformed codes", () => {
    expect(minorUnitExponent("usd")).toBeNull();
    expect(minorUnitExponent("US")).toBeNull();
  });
});

describe("formatMinor", () => {
  it("formats by the currency's minor unit", () => {
    expect(formatMinor(7500, "USD")).toBe("$75.00");
    expect(formatMinor(11000, "JPY")).toContain("11,000");
  });
});

describe("allocateLineItem", () => {
  it("splits equally and gives leftover units to the first members", () => {
    const result = allocateLineItem(equal("room", 10001, ["a", "b", "c"]));
    expect(result).toEqual({ ok: true, value: { a: 3334, b: 3334, c: 3333 } });
  });

  it("always adds up to the total", () => {
    for (const total of [1, 2, 7, 99, 100001]) {
      const result = allocateLineItem(equal("x", total, ["a", "b", "c", "d"]));
      if (!result.ok) throw new Error("expected ok");
      expect(Object.values(result.value).reduce((s, v) => s + v, 0)).toBe(total);
    }
  });

  it("accepts custom amounts that add up", () => {
    const item: LineItem = { id: "x", label: "x", totalMinor: 1000, allocation: { type: "custom", amountsMinor: { a: 700, b: 300 } } };
    expect(allocateLineItem(item)).toEqual({ ok: true, value: { a: 700, b: 300 } });
  });

  it("rejects custom amounts that do not add up", () => {
    const item: LineItem = { id: "x", label: "x", totalMinor: 1000, allocation: { type: "custom", amountsMinor: { a: 700, b: 200 } } };
    const result = allocateLineItem(item);
    expect(result.ok ? null : result.error.code).toBe("shares_mismatch");
  });

  it("rejects non-integer, zero and negative amounts", () => {
    for (const bad of [0, -5, 10.5]) {
      const item: LineItem = { id: "x", label: "x", totalMinor: 1000, allocation: { type: "custom", amountsMinor: { a: bad, b: 1000 - bad } } };
      const result = allocateLineItem(item);
      expect(result.ok ? null : result.error.code).toBe("invalid_share");
    }
  });

  it("rejects a bad total, an empty member list and duplicates", () => {
    const code = (item: LineItem) => {
      const result = allocateLineItem(item);
      return result.ok ? null : result.error.code;
    };
    expect(code(equal("x", 0, ["a"]))).toBe("invalid_total");
    expect(code(equal("x", 10.5, ["a"]))).toBe("invalid_total");
    expect(code(equal("x", 100, []))).toBe("no_members");
    expect(code(equal("x", 100, ["a", "a"]))).toBe("duplicate_member");
  });
});

describe("convertMinor", () => {
  it("returns the amount unchanged for the same currency", () => {
    expect(convertMinor(1234, "USD", "USD", fx)).toEqual({ ok: true, value: 1234 });
  });

  it("converts into another currency and rounds up", () => {
    // 10.01 USD x 1.35 = 13.5135 SGD, rounded up to 13.52
    expect(convertMinor(1001, "USD", "SGD", fx)).toEqual({ ok: true, value: 1352 });
  });

  it("handles zero-decimal currencies", () => {
    expect(convertMinor(1001, "USD", "JPY", fx)).toEqual({ ok: true, value: 1502 });
  });

  it("is not thrown off by float noise", () => {
    // 1.1 x 100 is 110.00000000000001 in floats; it must still be 110
    const table: FxRateTable = { baseCurrency: "USD", source: "t", ratesPerBase: { EUR: 1.1 } };
    expect(convertMinor(10000, "USD", "EUR", table)).toEqual({ ok: true, value: 11000 });
  });

  it("converts between two non-base currencies through the base", () => {
    expect(rateBetween(fx, "SGD", "JPY")).toBeCloseTo(150 / 1.35, 10);
  });

  it("errors on a missing rate or bad currency code", () => {
    const missing = convertMinor(100, "USD", "EUR", fx);
    expect(missing.ok ? null : missing.error.code).toBe("missing_rate");
    const bad = convertMinor(100, "USD", "xx", fx);
    expect(bad.ok ? null : bad.error.code).toBe("invalid_currency");
  });

  it("ignores unusable rates", () => {
    const table: FxRateTable = { baseCurrency: "USD", source: "t", ratesPerBase: { SGD: 0, JPY: Number.NaN } };
    expect(rateBetween(table, "USD", "SGD")).toBeNull();
    expect(rateBetween(table, "USD", "JPY")).toBeNull();
  });
});

describe("computeMemberShares", () => {
  // The Bangkok trip from the wireframe, in USD.
  const everyone = ["nevin", "ana", "ben", "jia"];
  const lineItems: LineItem[] = [
    equal("flights", 72000, everyone),
    equal("triple-room", 42000, ["nevin", "ana", "ben"]),
    equal("single-room", 20000, ["jia"]),
    equal("market-tour", 12000, everyone),
    equal("cooking-class", 9000, ["nevin", "ana"]),
  ];
  const members = everyone.map((id) => ({ id, currency: "USD" }));

  it("gives each member only the costs they take part in", () => {
    const result = computeMemberShares({ lineItems, members, fx });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((share) => [share.memberId, share.shareMinor])).toEqual([
      ["nevin", 39500],
      ["ana", 39500],
      ["ben", 35000],
      ["jia", 41000],
    ]);
  });

  it("adds up to the plan total in the base currency", () => {
    const result = computeMemberShares({ lineItems, members, fx });
    if (!result.ok) throw new Error(result.error.message);
    const sum = result.value.reduce((running, share) => running + share.baseShareMinor, 0);
    expect(sum).toBe(totalOfLineItems(lineItems));
    expect(sum).toBe(155000);
  });

  it("keeps the breakdown of each share", () => {
    const result = computeMemberShares({ lineItems, members, fx });
    if (!result.ok) throw new Error(result.error.message);
    const jia = result.value.find((share) => share.memberId === "jia");
    expect(jia?.lines.map((line) => line.itemId)).toEqual(["flights", "single-room", "market-tour"]);
  });

  it("converts each share into the member's own currency", () => {
    const mixed = [
      { id: "nevin", currency: "SGD" },
      { id: "ana", currency: "USD" },
    ];
    const result = computeMemberShares({ lineItems: [equal("trip", 20001, ["nevin", "ana"])], members: mixed, fx });
    if (!result.ok) throw new Error(result.error.message);
    const [nevin, ana] = result.value;
    expect(nevin.baseShareMinor).toBe(10001);
    expect(nevin.shareMinor).toBe(13502); // 100.01 USD x 1.35 = 135.0135 SGD, rounded up
    expect(nevin.fxRate).toBe(1.35);
    expect(nevin.fxSource).toBe("test-rates");
    expect(ana.shareMinor).toBe(10000);
    expect(ana.fxRate).toBe(1);
  });

  it("rejects bad input", () => {
    const code = (lines: LineItem[], people = members) => {
      const result = computeMemberShares({ lineItems: lines, members: people, fx });
      return result.ok ? null : result.error.code;
    };
    expect(code([])).toBe("no_line_items");
    expect(code(lineItems, [])).toBe("no_members");
    expect(code(lineItems, [members[0], members[0]])).toBe("duplicate_member");
    expect(code([equal("x", 100, ["ghost"])])).toBe("unknown_member");
    expect(code([equal("x", 100, ["nevin"])])).toBe("member_has_no_share");
    expect(code([equal("x", 0, everyone)])).toBe("invalid_total");
  });

  it("errors when a member's currency has no rate", () => {
    const result = computeMemberShares({
      lineItems: [equal("x", 100, ["a"])],
      members: [{ id: "a", currency: "EUR" }],
      fx,
    });
    expect(result.ok ? null : result.error.code).toBe("missing_rate");
  });
});
