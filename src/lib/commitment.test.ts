import { describe, expect, it } from "vitest";
import { commitmentLabel, commitmentOf } from "./commitment";

describe("commitmentOf", () => {
  it("is approved once the hold is placed, and not yet before", () => {
    expect(commitmentOf({ held: true })).toBe("approved");
    expect(commitmentOf({ held: false })).toBe("not_yet");
  });
});

describe("commitmentLabel", () => {
  it("uses one word for each state", () => {
    expect(commitmentLabel("not_yet")).toBe("Not yet");
    expect(commitmentLabel("approved")).toBe("Approved");
  });
});
