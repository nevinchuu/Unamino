import { err, ok, type Result } from "@/lib/result";
import { approved, DEADLINE, flight, hotel, HARD, MemoryDetailsStore, MemoryPlanRepository, MemoryEffectRunner } from "@/domain/plan/test-support";
import type { MemberSnapshot } from "@/domain/plan/types";
import { travellerDetailsSchema, type TravellerDetails } from "@/domain/travellers/details";
import { SAMPLE_DETAILS } from "@/domain/travellers/test-support";
import type {
  BookingStoreError,
  CancelOutcome,
  FlightBookingRequest,
  FlightSupplier,
  HoldReadiness,
  HotelBookingRequest,
  HotelSupplier,
  SupplierBooking,
  SupplierBookingStatus,
  SupplierBookingStore,
  SupplierError,
  SupplierReceipt,
} from "./ports";

export const SAMPLE_TRAVELLER: TravellerDetails = travellerDetailsSchema.parse(SAMPLE_DETAILS);

/** A supplier that books what it is given, remembers the calls in order, and can be made to refuse or fail. */
export class FakeSupplier implements HotelSupplier, FlightSupplier {
  readonly booked: (HotelBookingRequest | FlightBookingRequest)[] = [];
  readonly cancelled: string[] = [];
  failBooking: SupplierError | null = null;
  failCancel: SupplierError | null = null;
  cancelOutcome: CancelOutcome = "cancelled";
  private count = 0;

  constructor(private readonly prefix: string, private readonly log: string[] = []) {}

  async book(request: HotelBookingRequest | FlightBookingRequest): Promise<Result<SupplierReceipt, SupplierError>> {
    this.log.push(`book ${this.prefix}`);
    if (this.failBooking) return err(this.failBooking);
    this.booked.push(request);
    this.count += 1;
    return ok({ bookingId: `${this.prefix}-${this.count}`, confirmation: `CONF-${this.prefix}-${this.count}` });
  }

  async cancel(bookingId: string): Promise<Result<CancelOutcome, SupplierError>> {
    this.log.push(`cancel ${bookingId}`);
    if (this.failCancel) return err(this.failCancel);
    this.cancelled.push(bookingId);
    return ok(this.cancelOutcome);
  }
}

export class MemoryBookingStore implements SupplierBookingStore {
  readonly rows: SupplierBooking[] = [];
  failRecord = false;

  async record(booking: SupplierBooking): Promise<Result<void, BookingStoreError>> {
    if (this.failRecord) return err({ message: "db down" });
    if (!this.rows.some((row) => row.planId === booking.planId && row.pickId === booking.pickId)) this.rows.push(booking);
    return ok(undefined);
  }

  async list(planId: string): Promise<Result<readonly SupplierBooking[], BookingStoreError>> {
    return ok(this.rows.filter((row) => row.planId === planId));
  }

  async setStatus(planId: string, pickId: string, status: SupplierBookingStatus): Promise<Result<void, BookingStoreError>> {
    const index = this.rows.findIndex((row) => row.planId === planId && row.pickId === pickId);
    if (index >= 0) this.rows[index] = { ...this.rows[index], status };
    return ok(undefined);
  }
}

export class FakeHolds implements HoldReadiness {
  why: string | null = null;
  unreachable = false;
  async problem(): Promise<Result<string | null, BookingStoreError>> {
    return this.unreachable ? err({ message: "stripe down" }) : ok(this.why);
  }
}

/** Two members who have approved with holds placed, a hotel for both and a flight for both. */
export function bookingSetup(members: MemberSnapshot[] = [approved("ana", { holdPlaced: true }), approved("ben", { holdPlaced: true })]) {
  const plans = new MemoryPlanRepository({ id: "plan-1", version: 1, plan: { status: "held", deadlineAt: DEADLINE, hardDeadlineAt: HARD, members } });
  const ids = members.map((member) => member.id);
  const details = new MemoryDetailsStore({
    planId: "plan-1",
    baseCurrency: "USD",
    fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} },
    offersCheckedAt: null,
    members: ids.map((id) => ({ id, currency: "USD" })),
    picks: [
      { id: "pick-flight", offer: flight(), searchId: null, memberIds: ids },
      { id: "pick-hotel", offer: hotel(), searchId: null, memberIds: ids },
    ],
    queries: new Map(),
  });
  const log: string[] = [];
  const hotels = new FakeSupplier("H", log);
  const flights = new FakeSupplier("F", log);
  const bookings = new MemoryBookingStore();
  const holds = new FakeHolds();
  const onward = new MemoryEffectRunner();
  const travellers = { load: async (): Promise<Result<TravellerDetails | null, { kind: "unreadable" } | { kind: "unavailable" }>> => ok(SAMPLE_TRAVELLER) };
  return { plans, details, hotels, flights, bookings, holds, onward, travellers, log };
}
