import type { PlanItemDto, PlanViewDto } from "@/domain/plan/view";
import { planReference } from "@/lib/plan-reference";

/** One line of a printed trip pack or of the calendar entry's notes, such as "Hotel · Mövenpick · Tue 15 Dec to Fri 18 Dec". */
export function itemLines(item: PlanItemDto): readonly string[] {
  const code = item.bookingCode ? [`Booking code: ${item.bookingCode}`] : [];
  switch (item.kind) {
    case "flight":
      return [item.title, ...item.legs.map((leg) => `${leg.direction === "outbound" ? "Outbound" : "Return"}: ${leg.route}, ${leg.departs} to ${leg.arrives}, ${leg.carrier}`), ...code];
    case "hotel":
      return [`${item.title}, ${item.roomName}`, item.stay, ...code];
    case "activity":
      return [`${item.title}, ${item.when}`, ...code];
  }
}

const pad = (value: number): string => String(value).padStart(2, "0");
const compactDate = (date: string): string => date.replaceAll("-", "");
const stamp = (now: Date): string => `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

/** The day after `date`, "YYYY-MM-DD". A calendar's all-day events end the morning after their last day. */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10);
}

/** Text in an .ics file: backslash, semicolon and comma are escaped and a line break is written as \n. */
function escapeText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Lines longer than 75 bytes are continued on the next line, which starts with a space. A character is never split. */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    // A continuation line starts with a space, which takes one of its 75 bytes.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * A calendar entry for the trip, one all-day event from the first day to the last, with the bookings in its notes. Null
 * when the trip has no dates, because there is nowhere to put it. It holds no contact or card details.
 */
export function buildCalendar(view: PlanViewDto, now: Date): string | null {
  const start = view.tripDates.departDate ?? view.tripDates.returnDate;
  const end = view.tripDates.returnDate ?? view.tripDates.departDate;
  if (start === null || end === null) return null;

  const notes = [`Reference ${planReference(view.id)}`, ...view.items.flatMap((item) => ["", ...itemLines(item)])];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Unamino//Trip pack//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${view.id}@unamino`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDay(end))}`,
    `SUMMARY:${escapeText(view.title)}`,
    ...(view.city ? [`LOCATION:${escapeText(view.city)}`] : []),
    `DESCRIPTION:${escapeText(notes.join("\n"))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The name the calendar file is saved under, such as "unamino-UN-7F3A2C.ics". */
export const calendarFileName = (planId: string): string => `unamino-${planReference(planId)}.ics`;
