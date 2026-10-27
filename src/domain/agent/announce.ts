/**
 * What the agent says when something goes wrong or it cannot answer. Everything else it says is its own words.
 * These say what to do, never what went wrong inside.
 */
export const MESSAGES = {
  limited: "I'm getting a lot of requests, so I'm taking a short break. Please try again in a little while.",
  busy: "I am still working on the last request. I will post here when it is done.",
  planner_unavailable: "I could not reach my assistant just now. Please try again in a moment.",
  invalid_output: "I could not make sense of that. Could you say it a different way and mention me again?",
  too_long: "That took me too long to work out. Could you narrow it down a bit and mention me again?",
  plan_ready: "I made a plan for you. Take a look at it below.",
  booking_started: "Booking has already started for the current plan, so it can no longer be changed.",
  trip_booked: "The trip is already booked, so the plan can no longer be changed.",
  prices_expired: "The prices I found have already run out. Please mention me again.",
  conflict: "Someone else just changed the plan. Please mention me again.",
  no_exchange_rate: "I cannot price this for everyone yet because I have no exchange rate for one of the currencies.",
  failed: "Something went wrong on my side. Please try again.",
} as const;
