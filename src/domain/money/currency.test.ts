import { describe, expect, it } from "vitest";
import { toMinorUnits } from "./currency";

describe("toMinorUnits", () => {
  it("converts a major-unit price to whole minor units", () => {
    expect(toMinorUnits(304.55, "USD")).toBe(30455);
    expect(toMinorUnits(1067.43, "USD")).toBe(106743);
  });

  it("is not thrown off by float noise", () => {
    expect(toMinorUnits(0.29, "USD")).toBe(29); // 0.29 * 100 = 28.999999999999996
    expect(toMinorUnits(1.1, "USD")).toBe(110);
  });

  it("does not scale zero-decimal currencies", () => {
    expect(toMinorUnits(11000, "JPY")).toBe(11000);
  });

  it("returns null for amounts and currencies it cannot price", () => {
    expect(toMinorUnits(0, "USD")).toBeNull();
    expect(toMinorUnits(-5, "USD")).toBeNull();
    expect(toMinorUnits(Number.NaN, "USD")).toBeNull();
    expect(toMinorUnits(Number.POSITIVE_INFINITY, "USD")).toBeNull();
    expect(toMinorUnits(10, "usd")).toBeNull();
    expect(toMinorUnits(0.001, "USD")).toBeNull();
  });
});
