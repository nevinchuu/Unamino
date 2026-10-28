import { describe, expect, it } from "vitest";
import { splitForStack } from "./avatar-stack";

const people = (count: number): string[] => Array.from({ length: count }, (_, index) => `p${index}`);

describe("splitForStack", () => {
  it("shows everyone when they fit", () => {
    expect(splitForStack(people(3), 4)).toEqual({ shown: people(3), hiddenCount: 0 });
  });

  it("folds the rest into a count once there are more than fit", () => {
    expect(splitForStack(people(9), 4)).toEqual({ shown: people(4), hiddenCount: 5 });
  });

  it("never shows a lone +1: that person gets their own avatar", () => {
    expect(splitForStack(people(5), 4)).toEqual({ shown: people(5), hiddenCount: 0 });
  });

  it("shows at least one person even when asked for none", () => {
    expect(splitForStack(people(4), 0)).toEqual({ shown: people(1), hiddenCount: 3 });
  });

  it("copes with an empty group", () => {
    expect(splitForStack([], 4)).toEqual({ shown: [], hiddenCount: 0 });
  });
});
