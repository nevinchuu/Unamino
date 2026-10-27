/**
 * Both flight sources write departure times as local time at the departure airport
 * (with or without an offset), so the clock reading is the text after the "T".
 * Returns "HH:mm", or null if the text has no time.
 */
export const clockTime = (dateTime: string): string | null => /T(\d{2}:\d{2})/.exec(dateTime)?.[1] ?? null;
