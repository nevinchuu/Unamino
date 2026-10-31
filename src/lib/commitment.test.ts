import { describe, expect, it } from "vitest";
import { commitmentLabel, commitmentOf, type Commitment } from "./commitment";

describe("commitmentOf", () => {
  it("is the furthest step the person has completed", () => {
    expect(commitmentOf({ agreed: false, approved: false, held: false })).toBe("not_yet");
    expect(commitmentOf({ agreed: true, approved: false, held: false })).toBe("agreed");
    expect(commitmentOf({ agreed: true, approved: true, held: false })).toBe("approved");
    expect(commitmentOf({ agreed: true, approved: true, held: true })).toBe("in");
  });

  it("counts a placed hold as in even if the other flags were not read", () => {
    expect(commitmentOf({ agreed: false, approved: false, held: true })).toBe("in");
  });
});

describe("commitmentLabel", () => {
  it("uses one word for each state", () => {
    const states: Commitment[] = ["not_yet", "agreed", "approved", "in"];
    expect(states.map((state) => commitmentLabel(state))).toEqual(["Not yet", "Agreed", "Approved", "In"]);
  });

  it("says a card is still to add only for someone who approved", () => {
    expect(commitmentLabel("approved", true)).toBe("Approved, card to add");
    expect(commitmentLabel("agreed", true)).toBe("Agreed");
    expect(commitmentLabel("in", true)).toBe("In");
  });
});
