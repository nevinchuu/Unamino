import { describe, expect, it } from "vitest";
import { retentionNotice } from "./retention-notice";

describe("retentionNotice", () => {
  it("names the day the trip is deleted", () => {
    expect(retentionNotice("2027-01-17")).toBe("We keep this trip until 17 Jan 2027, then delete the chat, the plans and the booking details. Save your trip pack to keep a copy.");
  });

  it("says how long after the trip when it has no dates", () => {
    expect(retentionNotice(null)).toContain("until 30 days after the trip ends,");
  });
});
