import { describe, expect, it } from "vitest";
import type { ValidatedPlan } from "@/domain/planner/validate";
import { absoluteMinutes, dateOfAbsolute, datesBetween, formatMinutes, localMoment, subtractSpans, toMinutes, weekdayOf } from "./time";
import { buildSchedule } from "./build-schedule";
import { wireframePlan } from "./test-support";

function schedule(plan: ValidatedPlan) {
  const result = buildSchedule(plan);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("the wireframe trip", () => {
  const result = schedule(wireframePlan());

  it("lays out each day from what was bought", () => {
    expect(result.days.map((day) => day.date)).toEqual(["2026-12-11", "2026-12-12", "2026-12-13"]);
    const friday = result.days[0].entries;
    expect(friday[0]).toMatchObject({ kind: "flight", startTime: "20:10", endTime: "21:35", memberIds: ["nevin", "ana", "ben", "jia"] });
    expect(friday.slice(1).map((entry) => [entry.kind, entry.memberIds])).toEqual([
      ["hotel_check_in", ["nevin", "ana", "ben"]],
      ["hotel_check_in", ["jia"]],
    ]);
  });

  it("shows who goes to each activity", () => {
    const saturday = result.days[1].entries;
    expect(saturday.map((entry) => [entry.startTime, entry.endTime, entry.memberIds.length])).toEqual([["08:00", "12:00", 4], ["14:00", "17:00", 2]]);
  });

  it("shows a flight that lands after midnight on the day it leaves", () => {
    const sunday = result.days[2].entries;
    expect(sunday[0]).toMatchObject({ kind: "flight", startTime: "21:30", endTime: "00:55", endsOn: "2026-12-14" });
    expect(sunday.slice(1).map((entry) => entry.kind)).toEqual(["hotel_check_out", "hotel_check_out"]);
  });

  it("finds the time the whole group is free", () => {
    expect(result.gaps).toEqual([
      { id: "gap-2026-12-12-1230", date: "2026-12-12", startTime: "12:30", endTime: "13:30", minutes: 60 },
      { id: "gap-2026-12-12-1730", date: "2026-12-12", startTime: "17:30", endTime: "22:00", minutes: 270 },
      { id: "gap-2026-12-13-0800", date: "2026-12-13", startTime: "08:00", endTime: "18:30", minutes: 630 },
    ]);
  });
});

describe("free time", () => {
  const withOffers = (change: (offer: ValidatedPlan["picks"][number]["offer"]) => ValidatedPlan["picks"][number]["offer"]): ValidatedPlan => {
    const plan = wireframePlan();
    return { ...plan, picks: plan.picks.map((pick) => ({ ...pick, offer: change(pick.offer) })) };
  };

  it("leaves no gap on a day with an activity that has no start time", () => {
    const plan = withOffers((offer) => (offer.kind === "activity" && offer.id === "fx-act-market" ? { ...offer, startTime: undefined } : offer));
    expect(schedule(plan).gaps.map((gap) => gap.id)).toEqual(["gap-2026-12-13-0800"]);
  });

  it("opens Friday evening and ends Sunday sooner when the group lands and leaves earlier", () => {
    // Lands 14:30 (free from 16:00, after the 90 minute transfer) and leaves 18:40 (at the airport by 15:40).
    const result = schedule(
      withOffers((offer) =>
        offer.kind === "flight"
          ? { ...offer, legs: offer.legs.map((leg) => (leg.direction === "outbound" ? { ...leg, arriveAt: "2026-12-11T14:30:00+07:00" } : { ...leg, departAt: "2026-12-13T18:40:00+07:00" })) }
          : offer,
      ),
    );
    expect(result.gaps[0]).toMatchObject({ date: "2026-12-11", startTime: "16:00", endTime: "22:00" });
    expect(result.gaps.at(-1)).toMatchObject({ date: "2026-12-13", endTime: "15:40" });
  });

  it("drops gaps shorter than an hour", () => {
    const plan = withOffers((offer) => (offer.kind === "activity" && offer.id === "fx-act-cooking" ? { ...offer, startTime: "13:00" } : offer));
    expect(schedule(plan).gaps.map((gap) => gap.id)).not.toContain("gap-2026-12-12-1230");
  });

  it("has no gaps at all when the trip is too short", () => {
    const plan = withOffers((offer) =>
      offer.kind === "flight"
        ? { ...offer, legs: offer.legs.map((leg) => (leg.direction === "inbound" ? { ...leg, departAt: "2026-12-11T23:30:00+07:00" } : leg)) }
        : offer,
    );
    expect(schedule(plan).gaps).toEqual([]);
  });
});

describe("a plan without flights", () => {
  it("cannot be placed in time", () => {
    const plan = wireframePlan();
    const result = buildSchedule({ ...plan, picks: plan.picks.filter((pick) => pick.offer.kind !== "flight") });
    expect(result).toMatchObject({ ok: false, error: { code: "missing_flights" } });
  });

  it("names the member who has no return flight", () => {
    const plan = wireframePlan();
    const flight = plan.picks[0];
    const outboundOnly = flight.offer.kind === "flight" ? { ...flight, offer: { ...flight.offer, legs: flight.offer.legs.filter((leg) => leg.direction === "outbound") } } : flight;
    const result = buildSchedule({ ...plan, picks: [outboundOnly, ...plan.picks.slice(1)] });
    expect(!result.ok && result.error.message).toContain("nevin");
  });
});

describe("time helpers", () => {
  it("converts between clock times and minutes", () => {
    expect(toMinutes("14:30")).toBe(870);
    expect(formatMinutes(870)).toBe("14:30");
    expect(formatMinutes(5)).toBe("00:05");
  });

  it("knows the weekday of a date", () => {
    expect(weekdayOf("2026-12-13")).toBe(0); // Sunday
    expect(weekdayOf("2026-12-12")).toBe(6); // Saturday
  });

  it("lists every date in a range and handles one day", () => {
    expect(datesBetween("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(datesBetween("2026-12-12", "2026-12-12")).toEqual(["2026-12-12"]);
    expect(datesBetween("2026-12-13", "2026-12-12")).toEqual([]);
  });

  it("puts moments on one scale across midnight", () => {
    const late = absoluteMinutes("2026-12-11", 23 * 60 + 5);
    expect(dateOfAbsolute(late + 90)).toBe("2026-12-12");
    expect(absoluteMinutes("2026-12-12", 0) - absoluteMinutes("2026-12-11", 0)).toBe(1440);
  });

  it("reads flight times as local wall-clock time", () => {
    expect(localMoment("2026-12-11T20:10:00+08:00")).toEqual({ date: "2026-12-11", minutes: 1210 });
    expect(localMoment("2026-12-11T09:15:00")).toEqual({ date: "2026-12-11", minutes: 555 });
    expect(localMoment("2026-12-11")).toBeNull();
  });

  it("subtracts busy spans from a span", () => {
    expect(subtractSpans({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 60, end: 70 }])).toEqual([
      { start: 0, end: 20 }, { start: 30, end: 60 }, { start: 70, end: 100 },
    ]);
    expect(subtractSpans({ start: 0, end: 100 }, [{ start: -10, end: 110 }])).toEqual([]);
    expect(subtractSpans({ start: 0, end: 100 }, [{ start: 200, end: 300 }])).toEqual([{ start: 0, end: 100 }]);
    expect(subtractSpans({ start: 10, end: 50 }, [{ start: 0, end: 30 }])).toEqual([{ start: 30, end: 50 }]);
  });
});
