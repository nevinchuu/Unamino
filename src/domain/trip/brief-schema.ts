import { z } from "zod";

const airportCode = z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter airport code");
const countryCode = z.string().regex(/^[A-Z]{2}$/, "Expected a 2-letter country code");

/** Models often write `null` for "not mentioned" instead of leaving the field out, so both mean the same. */
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? undefined);

/**
 * What the group has said about where and when, as far as the model understood it. Every field is optional,
 * because most chats start without all of it. Code, not the model, decides whether it is enough to search.
 */
export const tripFieldsSchema = z.strictObject({
  destinationCity: optional(z.string().trim().min(1).max(80)),
  destinationCountry: optional(countryCode),
  /** The main airport serving the destination, which the flight search needs. */
  destinationAirport: optional(airportCode),
  originAirport: optional(airportCode),
  departDate: optional(z.iso.date()),
  returnDate: optional(z.iso.date()),
});

/** Partial because a field the chat never settled is simply absent. */
export type TripFields = Partial<z.infer<typeof tripFieldsSchema>>;
