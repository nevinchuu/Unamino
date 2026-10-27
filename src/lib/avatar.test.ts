import { describe, expect, it } from "vitest";
import { avatarColour, initialsOf } from "./avatar";

describe("initialsOf", () => {
  it.each([
    ["Nevin", "N"],
    ["ana lopez", "AL"],
    ["  Jia   Hui   Tan ", "JT"],
    ["éclair", "É"],
    ["", "?"],
    ["   ", "?"],
  ])("turns %j into %j", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it("keeps an emoji whole instead of cutting it in half", () => {
    expect(initialsOf("🌴 Bangkok")).toBe("🌴B");
  });
});

describe("avatarColour", () => {
  it("gives the same name the same colour every time", () => {
    expect(avatarColour("Nevin")).toBe(avatarColour("Nevin"));
  });

  it("always gives a real colour, even for an empty or unusual name", () => {
    for (const seed of ["", "a", "🌴", "x".repeat(500)]) expect(avatarColour(seed)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("uses more than one colour across different names", () => {
    const colours = new Set(["Nevin", "Ana", "Ben", "Jia", "Maya", "Omar", "Priya", "Sam"].map(avatarColour));
    expect(colours.size).toBeGreaterThan(2);
  });
});
