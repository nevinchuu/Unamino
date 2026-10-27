import { err, ok, type Result } from "@/lib/result";
import type { ActivityOffer, FlightOffer } from "@/domain/offers/schema";
import type { ValidatedPick, ValidatedPlan } from "@/domain/planner/validate";
import {
  absoluteMinutes,
  dateOfAbsolute,
  datesBetween,
  formatMinutes,
  localMoment,
  subtractSpans,
  toMinutes,
  MINUTES_PER_DAY,
  type Span,
} from "./time";
import type { FreeGap, Schedule, ScheduleEntry, ScheduleError } from "./types";

/** Suggestions are for waking hours only. */
const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 22 * 60;
/** Shorter gaps are not worth planning around. */
const MIN_GAP_MINUTES = 60;
/** Time to get from the airport into the city after landing, and to be at the airport before leaving. */
const ARRIVAL_BUFFER_MINUTES = 90;
const DEPARTURE_BUFFER_MINUTES = 180;
/** Getting to and from an activity. */
const TRAVEL_BUFFER_MINUTES = 30;
const LAST_MINUTE_OF_DAY = MINUTES_PER_DAY - 1;

const missingFlights = (memberId: string): ScheduleError => ({
  code: "missing_flights",
  message: `${memberId} has no outbound and return flight, so their time in the city cannot be worked out`,
});

function flightEntries(pick: ValidatedPick, flight: FlightOffer): ScheduleEntry[] {
  return flight.legs.flatMap((leg) => {
    const departs = localMoment(leg.departAt);
    const arrives = localMoment(leg.arriveAt);
    if (!departs || !arrives) return [];
    return [{
      kind: "flight" as const,
      offerId: flight.id,
      title: `${leg.origin} to ${leg.destination} (${leg.carrier})`,
      memberIds: pick.memberIds,
      date: departs.date,
      startTime: formatMinutes(departs.minutes),
      endTime: formatMinutes(arrives.minutes),
      endsOn: arrives.date === departs.date ? null : arrives.date,
    }];
  });
}

function activityEntry(pick: ValidatedPick, activity: ActivityOffer): ScheduleEntry {
  const start = activity.startTime === undefined ? null : toMinutes(activity.startTime);
  return {
    kind: "activity",
    offerId: activity.id,
    title: activity.title,
    memberIds: pick.memberIds,
    date: activity.date,
    startTime: activity.startTime ?? null,
    endTime: start === null ? null : formatMinutes(Math.min(start + activity.durationMinutes, LAST_MINUTE_OF_DAY)),
    endsOn: null,
  };
}

function entriesOf(pick: ValidatedPick): ScheduleEntry[] {
  const { offer, memberIds } = pick;
  switch (offer.kind) {
    case "flight":
      return flightEntries(pick, offer);
    case "hotel":
      return [
        { kind: "hotel_check_in", offerId: offer.id, title: `Check in: ${offer.title}`, memberIds, date: offer.checkIn, startTime: null, endTime: null, endsOn: null },
        { kind: "hotel_check_out", offerId: offer.id, title: `Check out: ${offer.title}`, memberIds, date: offer.checkOut, startTime: null, endTime: null, endsOn: null },
      ];
    case "activity":
      return [activityEntry(pick, offer)];
  }
}

/** Timed entries first in time order, then the untimed ones such as hotel check-in. */
const byTime = (a: ScheduleEntry, b: ScheduleEntry): number => {
  if (a.startTime === null || b.startTime === null) return Number(a.startTime === null) - Number(b.startTime === null);
  return a.startTime.localeCompare(b.startTime);
};

/**
 * When the whole group is in the city: after the last person lands (plus time to reach the city)
 * and before the first person has to leave for the airport. Everyone needs an outbound and a return flight.
 */
function groupPresence(plan: ValidatedPlan): Result<Span, ScheduleError> {
  const memberIds = [...new Set(plan.picks.flatMap((pick) => pick.memberIds))];
  let arrivesLast = -Infinity;
  let leavesFirst = Infinity;

  for (const memberId of memberIds) {
    const legs = plan.picks.flatMap((pick) => (pick.offer.kind === "flight" && pick.memberIds.includes(memberId) ? pick.offer.legs : []));
    const arrivals = legs.filter((leg) => leg.direction === "outbound").flatMap((leg) => localMoment(leg.arriveAt) ?? []);
    const departures = legs.filter((leg) => leg.direction === "inbound").flatMap((leg) => localMoment(leg.departAt) ?? []);
    if (arrivals.length === 0 || departures.length === 0) return err(missingFlights(memberId));

    arrivesLast = Math.max(arrivesLast, ...arrivals.map((moment) => absoluteMinutes(moment.date, moment.minutes)));
    leavesFirst = Math.min(leavesFirst, ...departures.map((moment) => absoluteMinutes(moment.date, moment.minutes)));
  }
  return ok({ start: arrivesLast + ARRIVAL_BUFFER_MINUTES, end: leavesFirst - DEPARTURE_BUFFER_MINUTES });
}

/** Time taken by activities, with room to travel. An activity with no start time takes the whole day. */
function busySpans(plan: ValidatedPlan, date: string): readonly Span[] {
  return plan.picks.flatMap(({ offer }) => {
    if (offer.kind !== "activity" || offer.date !== date) return [];
    if (offer.startTime === undefined) {
      return [{ start: absoluteMinutes(date, 0), end: absoluteMinutes(date, MINUTES_PER_DAY) }];
    }
    const start = absoluteMinutes(date, toMinutes(offer.startTime));
    return [{ start: start - TRAVEL_BUFFER_MINUTES, end: start + offer.durationMinutes + TRAVEL_BUFFER_MINUTES }];
  });
}

function findGaps(plan: ValidatedPlan, presence: Span): readonly FreeGap[] {
  const gaps: FreeGap[] = [];
  for (const date of datesBetween(dateOfAbsolute(presence.start), dateOfAbsolute(presence.end))) {
    const awake: Span = {
      start: Math.max(absoluteMinutes(date, DAY_START_MINUTES), presence.start),
      end: Math.min(absoluteMinutes(date, DAY_END_MINUTES), presence.end),
    };
    if (awake.end - awake.start < MIN_GAP_MINUTES) continue;
    for (const free of subtractSpans(awake, busySpans(plan, date))) {
      if (free.end - free.start < MIN_GAP_MINUTES) continue;
      const startTime = formatMinutes(free.start - absoluteMinutes(date, 0));
      gaps.push({ id: `gap-${date}-${startTime.replace(":", "")}`, date, startTime, endTime: formatMinutes(free.end - absoluteMinutes(date, 0)), minutes: free.end - free.start });
    }
  }
  return gaps;
}

/**
 * Lays out what the group has bought, day by day, and finds the time when everyone is free.
 * Nothing here is invented: every entry comes from a picked offer.
 */
export function buildSchedule(plan: ValidatedPlan): Result<Schedule, ScheduleError> {
  const presence = groupPresence(plan);
  if (!presence.ok) return presence;

  const entries = plan.picks.flatMap(entriesOf);
  // An entry sits on the day it starts, so a flight landing after midnight does not add an empty day.
  const dates = entries.map((entry) => entry.date).sort();
  const days = datesBetween(dates[0], dates[dates.length - 1]).map((date) => ({
    date,
    entries: entries.filter((entry) => entry.date === date).sort(byTime),
  }));
  return ok({ days, gaps: findGaps(plan, presence.value) });
}
