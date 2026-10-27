import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;
const ISO_COUNTRY = /^[A-Z]{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OLDEST_TRAVELLER_YEARS = 120;

/** True for a real calendar day written YYYY-MM-DD ("2026-02-30" is not one). */
function isCalendarDay(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const name = (label: string) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(1, `Enter ${label}.`)
    .max(60, `${label[0].toUpperCase()}${label.slice(1)} is too long.`)
    .regex(NAME, `${label[0].toUpperCase()}${label.slice(1)} can only use letters, spaces, hyphens and apostrophes.`);

const country = (label: string) =>
  z
    .string({ error: `Choose ${label}.` })
    .trim()
    .toUpperCase()
    .regex(ISO_COUNTRY, `Choose ${label}.`);

const date = (label: string) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .refine(isCalendarDay, `Enter ${label} as year-month-day, for example 1990-05-17.`);

const passportSchema = z.object({
  number: z
    .string({ error: "Enter your passport number." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{5,20}$/, "A passport number uses 5 to 20 letters and digits, with no spaces."),
  issueCountry: country("the country that issued your passport"),
  expiry: date("your passport's expiry date"),
});

/** What the airline and the hotel need to know about one traveller. Held encrypted, never shown to anyone else. */
export const travellerDetailsSchema = z.object({
  firstName: name("your first name"),
  lastName: name("your last name"),
  birthday: date("your date of birth"),
  gender: z.enum(["M", "F", "X"], { error: "Choose M, F or X, as it is on your passport." }),
  nationality: country("your nationality"),
  email: z.email({ error: "Enter a valid email address." }).trim().max(200, "That email address is too long."),
  phoneCountryCode: z
    .string({ error: "Enter your phone's country code." })
    .trim()
    .regex(/^\d{1,4}$/, "Enter the country code as digits only, for example 65."),
  phoneNumber: z
    .string({ error: "Enter your phone number." })
    .trim()
    .regex(/^\d{4,14}$/, "Enter your phone number as digits only, with no spaces."),
  /** Only asked for when a flight needs it, which international flights do. */
  passport: passportSchema.optional(),
});

export type TravellerDetails = z.infer<typeof travellerDetailsSchema>;

/** Problems by field name ("firstName", "passport.expiry"), each already worded for the person. */
export type TravellerFieldErrors = Readonly<Record<string, string>>;

export interface TravellerRules {
  readonly now: Date;
  /** True when this person takes part in a flight that needs a passport. */
  readonly passportRequired: boolean;
}

const isoDay = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * Checks what a person typed. Format rules live in the schema; the rules that depend on today's date (born in the
 * past, passport not already expired) and on the trip (a passport only when needed) are applied here.
 */
export function validateTravellerInput(input: unknown, rules: TravellerRules): Result<TravellerDetails, TravellerFieldErrors> {
  const parsed = travellerDetailsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "form";
      errors[field] ??= issue.message;
    }
    return err(errors);
  }

  const details = parsed.data;
  const errors: Record<string, string> = {};
  const today = isoDay(rules.now);

  if (details.birthday >= today) errors.birthday = "Your date of birth must be in the past.";
  else if (details.birthday < `${Number(today.slice(0, 4)) - OLDEST_TRAVELLER_YEARS}${today.slice(4)}`) errors.birthday = "Check your date of birth.";

  if (rules.passportRequired && !details.passport) errors.passport = "A passport is needed for this trip.";
  if (details.passport && details.passport.expiry <= today) errors["passport.expiry"] = "That passport has expired.";

  if (Object.keys(errors).length > 0) return err(errors);
  // A passport nobody asked for is not kept.
  return ok(rules.passportRequired ? details : { ...details, passport: undefined });
}
