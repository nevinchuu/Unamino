import { z } from "zod";

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time as HH:mm");

/** A window for leaving, read as local time at the departure airport. Either end may be open. */
const timeWindow = z
  .object({ after: timeOfDay.optional(), before: timeOfDay.optional() })
  .refine((window) => window.after !== undefined || window.before !== undefined, {
    message: "A time window needs an after or a before",
  });

const budgetCap = z.object({
  amountMinor: z.number().int().positive(),
  /** The member's own currency, so a cap is compared with their share after conversion. */
  currency: z.string().regex(/^[A-Z]{3}$/),
});

/**
 * What one member told the agent they need. Every field is optional: no constraint means no restriction.
 * The planner turns chat messages into this shape, and plain code checks offers against it.
 */
export const memberConstraintsSchema = z.object({
  budgetCap: budgetCap.optional(),
  outboundDeparture: timeWindow.optional(),
  returnDeparture: timeWindow.optional(),
  /** Wants a room with no one else in it. */
  ownRoom: z.boolean().optional(),
  /** Lowercase activity categories this member will not join, e.g. "cooking". */
  skipActivityCategories: z.array(z.string().trim().toLowerCase().min(1)).optional(),
});

export type MemberConstraints = z.infer<typeof memberConstraintsSchema>;

/** Constraints for the whole group, keyed by member id. A member who said nothing may be missing. */
export const constraintSetSchema = z.record(z.string().min(1), memberConstraintsSchema);

export type ConstraintSet = z.infer<typeof constraintSetSchema>;
