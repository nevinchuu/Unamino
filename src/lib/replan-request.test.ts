import { describe, expect, it } from "vitest";
import { splitAgentMentions } from "@/domain/group/mention";
import { removedFriendRequest } from "./replan-request";

describe("removedFriendRequest", () => {
  it("names the person who is out and asks for a new plan for everyone else", () => {
    expect(removedFriendRequest("Dan")).toBe("@trippy Dan is no longer coming. Please make a new plan for the rest of us, same trip.");
  });

  it("mentions Trippy, so the message starts a run", () => {
    expect(splitAgentMentions(removedFriendRequest("Dan")).some((part) => part.isMention)).toBe(true);
  });
});
