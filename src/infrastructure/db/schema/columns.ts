import { bigint, char, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const instant = (name: string) => timestamp(name, { withTimezone: true });

/** Money in minor units. Plain numbers are exact up to 2^53, far beyond any trip. */
export const minor = (name: string) => bigint(name, { mode: "number" });

export const currencyCode = (name: string) => char(name, { length: 3 });
