import { describe, expect, it } from "vitest";
import { cleanParts, composeDate, isFull, splitDate } from "./date-input";

describe("composeDate", () => {
  it("writes the date the form sends, in the order year, month, day", () => {
    expect(composeDate({ day: "02", month: "03", year: "1991" })).toBe("1991-03-02");
  });

  it("pads a day or month typed with one digit", () => {
    expect(composeDate({ day: "2", month: "3", year: "1991" })).toBe("1991-03-02");
  });

  it("is empty while any box is empty or the year is not four digits", () => {
    expect(composeDate({ day: "", month: "03", year: "1991" })).toBe("");
    expect(composeDate({ day: "02", month: "", year: "1991" })).toBe("");
    expect(composeDate({ day: "02", month: "03", year: "" })).toBe("");
    expect(composeDate({ day: "02", month: "03", year: "91" })).toBe("");
  });

  it("ignores anything that is not a digit and anything past the box's size", () => {
    expect(composeDate({ day: "0x2", month: "03 ", year: "19912" })).toBe("1991-03-02");
  });

  it("leaves a day that does not exist for the server to refuse, with the same words as any other field", () => {
    expect(composeDate({ day: "30", month: "02", year: "1990" })).toBe("1990-02-30");
  });
});

describe("cleanParts", () => {
  it("keeps only digits and the box's length", () => {
    expect(cleanParts({ day: "a1b2c3", month: "1-2", year: "20 26 9" })).toEqual({ day: "12", month: "12", year: "2026" });
  });
});

describe("splitDate", () => {
  it("fills the boxes from a saved date", () => {
    expect(splitDate("1991-03-02")).toEqual({ day: "02", month: "03", year: "1991" });
  });

  it("gives empty boxes for anything else", () => {
    expect(splitDate("")).toEqual({ day: "", month: "", year: "" });
    expect(splitDate("2/3/91")).toEqual({ day: "", month: "", year: "" });
  });
});

describe("isFull", () => {
  it("says when a box has all its digits", () => {
    expect(isFull("02", 2)).toBe(true);
    expect(isFull("2", 2)).toBe(false);
    expect(isFull("1991", 4)).toBe(true);
    expect(isFull("199", 4)).toBe(false);
  });
});
