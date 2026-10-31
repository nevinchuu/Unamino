import { describe, expect, it } from "vitest";
import { previousShareNote } from "./share-change";

describe("previousShareNote", () => {
  it("says what the previous plan would have cost, whether the amount went up or down", () => {
    expect(previousShareNote(6_422, 6_800, "USD")).toBe("Was $68.00 on the previous plan");
    expect(previousShareNote(12_844, 6_422, "USD")).toBe("Was $64.22 on the previous plan");
  });

  it("says nothing when there was no previous plan, they were not in it, or the amount did not move", () => {
    expect(previousShareNote(6_422, null, "USD")).toBeNull();
    expect(previousShareNote(null, 6_800, "USD")).toBeNull();
    expect(previousShareNote(6_422, 6_422, "USD")).toBeNull();
  });
});
