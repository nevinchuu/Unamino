import { describe, expect, it } from "vitest";
import { mentionsAgent } from "@/domain/group/mention";
import { DEMO_FRIEND_KEYS, demoPlanRequest, demoWeekend } from "./demo-start";

describe("demoWeekend", () => {
  it("is the first Friday at least four weeks away, to the Sunday after it", () => {
    expect(demoWeekend(new Date("2026-10-31T10:00:00Z"))).toBe("from Fri 4 Dec 2026 to Sun 6 Dec 2026");
  });

  it("counts a Friday that is exactly four weeks away", () => {
    expect(demoWeekend(new Date("2026-11-13T23:59:00Z"))).toBe("from Fri 11 Dec 2026 to Sun 13 Dec 2026");
  });

  it("moves on to the next Friday when four weeks away is a Saturday", () => {
    expect(demoWeekend(new Date("2026-11-14T00:30:00Z"))).toBe("from Fri 18 Dec 2026 to Sun 20 Dec 2026");
  });

  it("carries over a month and a year end", () => {
    expect(demoWeekend(new Date("2026-12-10T10:00:00Z"))).toBe("from Fri 8 Jan 2027 to Sun 10 Jan 2027");
    expect(demoWeekend(new Date("2026-12-31T10:00:00Z"))).toBe("from Fri 29 Jan 2027 to Sun 31 Jan 2027");
    expect(demoWeekend(new Date("2027-01-02T10:00:00Z"))).toBe("from Fri 5 Feb 2027 to Sun 7 Feb 2027");
  });
});

describe("demoPlanRequest", () => {
  const request = demoPlanRequest(new Date("2026-10-31T10:00:00Z"));

  it("calls Trippy, so the message starts a run", () => {
    expect(mentionsAgent(request)).toBe(true);
  });

  it("asks for four people, hotel only, with the dates written out", () => {
    expect(request).toBe("@trippy plan a Bangkok hotel stay for the 4 of us, hotel only, we are all already there, from Fri 4 Dec 2026 to Sun 6 Dec 2026, about $200 each");
  });

  it("counts the person and each simulated friend", () => {
    expect(DEMO_FRIEND_KEYS).toHaveLength(3);
  });
});
