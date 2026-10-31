/** What the "Try the demo" button sets up: a group of the person and three simulated friends, and a first plan asked for on their behalf. */

export const DEMO_GROUP_NAME = "Bangkok demo";
/** The name the person goes by until they change it in Group info. */
export const DEMO_ORGANISER_NAME = "Guest";
/** Who joins as simulated friends: a tight budget, a room of their own, and an easygoing one. */
export const DEMO_FRIEND_KEYS = ["maya", "leo", "priya"] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY_MS = 86_400_000;
const FRIDAY = 5;
/** Far enough ahead that the hotel search has rooms and the dates are never in the past. */
const MIN_DAYS_AHEAD = 28;
const NIGHTS = 2;

const dayText = (date: Date): string => `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** The first Friday at least four weeks from `now`, and the Sunday after it, written out in full. */
export function demoWeekend(now: Date): string {
  const friday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + MIN_DAYS_AHEAD * DAY_MS);
  while (friday.getUTCDay() !== FRIDAY) friday.setTime(friday.getTime() + DAY_MS);
  return `from ${dayText(friday)} to ${dayText(new Date(friday.getTime() + NIGHTS * DAY_MS))}`;
}

/**
 * The message posted in the person's name to start the plan. It says hotel only because the simulated friends never fly,
 * and asks for the four of them, so Trippy does not stop to ask either question.
 */
export const demoPlanRequest = (now: Date): string => `@trippy plan a Bangkok hotel stay for the 4 of us, hotel only, we are all already there, ${demoWeekend(now)}, about $200 each`;
