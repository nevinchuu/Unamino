import { err, ok, type Result } from "@/lib/result";
import { travellerDetailsSchema, validateTravellerInput, type TravellerDetails, type TravellerFieldErrors } from "./details";
import type { TravellerCipher, TravellerStore } from "./ports";

/** "invalid": something typed is wrong, with a message per field. "unavailable": try again in a moment. */
export type SaveTravellerError =
  | { readonly kind: "invalid"; readonly fields: TravellerFieldErrors }
  | { readonly kind: "unavailable" };

/** "unreadable": what is stored cannot be opened (changed, or made with another key). "unavailable": try again in a moment. */
export type LoadTravellerError = { readonly kind: "unreadable" } | { readonly kind: "unavailable" };

export interface TravellerServiceDeps {
  readonly store: TravellerStore;
  readonly cipher: TravellerCipher;
  readonly clock: () => Date;
}

/** Takes in, locks away, hands to the booking, and deletes travellers' details. Nothing else may read them. */
export class TravellerService {
  constructor(private readonly deps: TravellerServiceDeps) {}

  /** Checks what the member typed and keeps it, locked. Replaces what they gave before. */
  async save(memberId: string, input: unknown, options: { readonly passportRequired: boolean }): Promise<Result<void, SaveTravellerError>> {
    const checked = validateTravellerInput(input, { now: this.deps.clock(), passportRequired: options.passportRequired });
    if (!checked.ok) return err({ kind: "invalid", fields: checked.error });

    const stored = await this.deps.store.put(memberId, this.deps.cipher.encrypt(JSON.stringify(checked.value), memberId));
    return stored.ok ? ok(undefined) : err({ kind: "unavailable" });
  }

  /** For the booking only. Null if the member has not given their details. */
  async load(memberId: string): Promise<Result<TravellerDetails | null, LoadTravellerError>> {
    const stored = await this.deps.store.get(memberId);
    if (!stored.ok) return err({ kind: "unavailable" });
    if (stored.value === null) return ok(null);

    const opened = this.deps.cipher.decrypt(stored.value, memberId);
    if (!opened.ok) return err({ kind: "unreadable" });
    try {
      const parsed = travellerDetailsSchema.safeParse(JSON.parse(opened.value));
      return parsed.success ? ok(parsed.data) : err({ kind: "unreadable" });
    } catch {
      return err({ kind: "unreadable" });
    }
  }

  /** Whether each of these members has given their details, without opening them. */
  async haveDetails(memberIds: readonly string[]): Promise<Result<ReadonlySet<string>, { readonly kind: "unavailable" }>> {
    const have = await this.deps.store.haveDetails(memberIds);
    return have.ok ? ok(new Set(have.value)) : err({ kind: "unavailable" });
  }

  /** Deletes these members' details. Run once the trip is booked, and when a plan ends. */
  async forget(memberIds: readonly string[]): Promise<Result<void, { readonly kind: "unavailable" }>> {
    const removed = await this.deps.store.remove(memberIds);
    return removed.ok ? ok(undefined) : err({ kind: "unavailable" });
  }
}
