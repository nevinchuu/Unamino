import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import type { BookingStoreError, SupplierBooking, SupplierBookingStatus, SupplierBookingStore } from "@/domain/booking/ports";
import type { Database } from "./client";
import { supplierBookings } from "./schema";

const unavailable = (): Result<never, BookingStoreError> => err({ message: "The database could not be reached" });

/** Keeps the bookings made with airlines and hotels. */
export class PostgresBookingStore implements SupplierBookingStore {
  constructor(private readonly db: Database) {}

  async record(booking: SupplierBooking): Promise<Result<void, BookingStoreError>> {
    try {
      // The first booking saved for a pick stays: saving again after a retry changes nothing.
      await this.db.insert(supplierBookings).values(booking).onConflictDoNothing();
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }

  async list(planId: string): Promise<Result<readonly SupplierBooking[], BookingStoreError>> {
    try {
      const rows = await this.db.select().from(supplierBookings).where(eq(supplierBookings.planId, planId)).orderBy(supplierBookings.createdAt);
      return ok(rows.map((row) => ({ planId: row.planId, pickId: row.pickId, kind: row.kind === "hotel" ? "hotel" : "flight", bookingId: row.bookingId, confirmation: row.confirmation, status: row.status })));
    } catch {
      return unavailable();
    }
  }

  async setStatus(planId: string, pickId: string, status: SupplierBookingStatus): Promise<Result<void, BookingStoreError>> {
    try {
      await this.db.update(supplierBookings).set({ status, updatedAt: new Date() }).where(and(eq(supplierBookings.planId, planId), eq(supplierBookings.pickId, pickId)));
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }
}
