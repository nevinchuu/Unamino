/** What a person typed into the day, month and year boxes. Anything that is not a digit is ignored. */
export interface DateParts {
  readonly day: string;
  readonly month: string;
  readonly year: string;
}

const digitsOnly = (value: string, max: number): string => value.replace(/\D/g, "").slice(0, max);

/** The boxes' own limits, so a stray letter or a fifth digit of the year is never kept. */
export const cleanParts = (parts: DateParts): DateParts => ({ day: digitsOnly(parts.day, 2), month: digitsOnly(parts.month, 2), year: digitsOnly(parts.year, 4) });

/**
 * "YYYY-MM-DD" for the form, or "" while a box is empty or the year is not four digits. A day or month typed as "5" becomes
 * "05". Whether the day exists (30 February) is for the server to say, in the same words as for any other field.
 */
export function composeDate(parts: DateParts): string {
  const { day, month, year } = cleanParts(parts);
  if (day === "" || month === "" || year.length !== 4) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** The boxes for a "YYYY-MM-DD" date, for showing a saved value. Anything else gives empty boxes. */
export function splitDate(iso: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? { day: match[3], month: match[2], year: match[1] } : { day: "", month: "", year: "" };
}

/** Whether a box is full, so focus can move to the next one. */
export const isFull = (value: string, size: 2 | 4): boolean => digitsOnly(value, size).length === size;
