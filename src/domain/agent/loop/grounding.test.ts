import { describe, expect, it } from "vitest";
import { amountsIn, numbersIn, ungroundedAmounts, withoutUngrounded } from "./grounding";

describe("finding amounts", () => {
  it("reads dollar amounts as written, with commas and cents", () => {
    expect(amountsIn("Flights $1,340.00 or US$99, not 5 stars or 20 minutes")).toEqual([
      { written: "$1,340.00", value: 1340 },
      { written: "US$99", value: 99 },
    ]);
  });

  it("collects every number, so a search result can ground a reply", () => {
    expect(numbersIn('{"pricePerPerson":"$180.00","stars":3}')).toEqual([180, 3]);
  });
});

describe("amounts that were never given", () => {
  const given = [180, 720, 350];

  it("accepts an amount that was given, and one rounded to the nearest dollar", () => {
    expect(ungroundedAmounts("$180.00 each, about $720 total, under your $350 cap", given)).toEqual([]);
  });

  it("names an amount that matches nothing", () => {
    expect(ungroundedAmounts("Flights are about $120 return", given)).toEqual(["$120"]);
  });

  it("ignores numbers that are not prices", () => {
    expect(ungroundedAmounts("3 nights, 5 stars, leaves at 20:10", given)).toEqual([]);
  });
});

describe("taking out what cannot be grounded", () => {
  it("drops only the lines that quote it", () => {
    expect(withoutUngrounded("Hi!\nFlights are $120.\nWhere from?", ["$120"])).toBe("Hi!\nWhere from?");
  });

  it("returns null when nothing is left", () => {
    expect(withoutUngrounded("Flights are $120.", ["$120"])).toBeNull();
  });
});
