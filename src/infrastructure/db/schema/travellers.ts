import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, instant } from "./columns";
import { members } from "./groups";

/**
 * Passport details the airline needs. Only ever stored encrypted, never read by the agent, and deleted
 * once the trip is booked.
 */
export const travellerDetails = pgTable("traveller_details", {
  memberId: uuid("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  createdAt: createdAt(),
  deletedAt: instant("deleted_at"),
}).enableRLS();
