import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { RETENTION } from "@/domain/retention/policy";
import { bookingRecordFor, type RecordedPayment, type RecordedSupplier } from "@/domain/retention/record";
import type { RetentionError, RetentionStore } from "@/domain/retention/retention-service";
import type { Database } from "./client";
import { bookingRecords, groups, members, planMembers, plans, supplierBookings, tripBriefs } from "./schema";

const unavailable = (): Result<never, RetentionError> => err({ message: "The database could not be reached" });

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Plans that are decided: nothing is being agreed, held or booked, so deleting the group lets go of nothing. */
const UNDECIDED = ["draft", "reviewing", "approving", "held", "booking"] as const;
const BOOKED = ["booked", "captured"] as const;

export class PostgresRetentionStore implements RetentionStore {
  constructor(private readonly db: Database) {}

  async expiredGroupIds(now: Date, limit: number): Promise<Result<readonly string[], RetentionError>> {
    const today = dayOf(now);
    const quietSince = new Date(now.getTime() - RETENTION.daysInactive * 24 * 60 * 60_000).toISOString();
    try {
      // A booked group is due once its latest trip ended long enough ago. A group that never booked is due once it has been quiet that long.
      const rows = await this.db.execute<{ id: string }>(sql`
        select g.id
        from groups g
        where not exists (select 1 from plans p where p.group_id = g.id and p.status in (${sql.join(UNDECIDED.map((status) => sql`${status}`), sql`, `)}))
          and (
            case
              when exists (select 1 from plans p where p.group_id = g.id and p.status in (${sql.join(BOOKED.map((status) => sql`${status}`), sql`, `)}))
              then (
                select max(coalesce(b.return_date, b.depart_date, p.created_at::date))
                from plans p join trip_briefs b on b.id = p.brief_id
                where p.group_id = g.id and p.status in (${sql.join(BOOKED.map((status) => sql`${status}`), sql`, `)})
              ) + ${RETENTION.daysAfterTrip}::int < ${today}::date
              else coalesce((select max(m.created_at) from messages m where m.group_id = g.id), g.created_at) < ${quietSince}::timestamptz
            end
          )
        order by g.created_at
        limit ${limit}
      `);
      return ok(rows.map((row) => row.id));
    } catch {
      return unavailable();
    }
  }

  async archiveAndDelete(groupId: string): Promise<Result<void, RetentionError>> {
    try {
      await this.db.transaction(async (tx) => {
        const booked = await tx.select().from(plans).where(and(eq(plans.groupId, groupId), inArray(plans.status, [...BOOKED])));
        for (const plan of booked) {
          const [brief] = await tx.select().from(tripBriefs).where(eq(tripBriefs.id, plan.briefId)).limit(1);
          const payers = await tx
            .select({ name: members.displayName, paymentId: planMembers.holdId, approvedMinor: planMembers.approvedMinor, chargedMinor: planMembers.chargedMinor, currency: members.currency })
            .from(planMembers)
            .innerJoin(members, eq(members.id, planMembers.memberId))
            .where(eq(planMembers.planId, plan.id));
          const suppliers = await tx.select().from(supplierBookings).where(eq(supplierBookings.planId, plan.id));

          const payments: RecordedPayment[] = payers.map((payer) => ({ payerName: payer.name, paymentId: payer.paymentId, approvedMinor: payer.approvedMinor, chargedMinor: payer.chargedMinor, currency: payer.currency }));
          const recorded: RecordedSupplier[] = suppliers.map((supplier) => ({ kind: supplier.kind, bookingId: supplier.bookingId, confirmation: supplier.confirmation }));
          const record = bookingRecordFor({
            planId: plan.id,
            title: plan.title,
            city: brief?.destinationCity ?? null,
            departDate: brief?.departDate ?? null,
            returnDate: brief?.returnDate ?? null,
            madeOn: dayOf(plan.createdAt),
            payments,
            suppliers: recorded,
          });
          await tx.insert(bookingRecords).values(record).onConflictDoNothing();
        }
        // Plans first: they point at the group's briefs and members, which removing the group takes away.
        await tx.delete(plans).where(eq(plans.groupId, groupId));
        await tx.delete(groups).where(eq(groups.id, groupId));
      });
      return ok(undefined);
    } catch {
      return unavailable();
    }
  }

  async purgeRecords(now: Date): Promise<Result<number, RetentionError>> {
    try {
      const removed = await this.db.delete(bookingRecords).where(lt(bookingRecords.purgeAfter, dayOf(now))).returning({ planId: bookingRecords.planId });
      return ok(removed.length);
    } catch {
      return unavailable();
    }
  }
}
