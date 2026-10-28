import { err, ok, type Result } from "@/lib/result";
import type { TravellerStore, TravellerStoreError } from "./ports";

/** A store held in memory for tests. `down` makes every call fail, as when the database cannot be reached. */
export class MemoryTravellerStore implements TravellerStore {
  readonly rows = new Map<string, string>();
  /** When each row was last saved, for the age-based deletion. Tests move the clock to make details old. */
  readonly savedAt = new Map<string, Date>();
  clock: () => Date = () => new Date();
  down = false;

  private check(): Result<void, TravellerStoreError> {
    return this.down ? err({ code: "unavailable", message: "down" }) : ok(undefined);
  }

  async put(memberId: string, ciphertext: string): Promise<Result<void, TravellerStoreError>> {
    const up = this.check();
    if (!up.ok) return up;
    this.rows.set(memberId, ciphertext);
    this.savedAt.set(memberId, this.clock());
    return ok(undefined);
  }

  async get(memberId: string): Promise<Result<string | null, TravellerStoreError>> {
    const up = this.check();
    return up.ok ? ok(this.rows.get(memberId) ?? null) : up;
  }

  async haveDetails(memberIds: readonly string[]): Promise<Result<readonly string[], TravellerStoreError>> {
    const up = this.check();
    return up.ok ? ok(memberIds.filter((id) => this.rows.has(id))) : up;
  }

  async remove(memberIds: readonly string[]): Promise<Result<void, TravellerStoreError>> {
    const up = this.check();
    if (!up.ok) return up;
    for (const id of memberIds) this.rows.delete(id);
    return ok(undefined);
  }

  async removeOlderThan(before: Date): Promise<Result<number, TravellerStoreError>> {
    const up = this.check();
    if (!up.ok) return up;
    const old = [...this.rows.keys()].filter((id) => (this.savedAt.get(id) ?? new Date(0)) < before);
    for (const id of old) this.rows.delete(id);
    return ok(old.length);
  }
}

/** A complete, valid set of details for a made-up traveller. */
export const SAMPLE_DETAILS = {
  firstName: "Daniel",
  lastName: "Tan",
  birthday: "1990-05-17",
  gender: "M",
  nationality: "SG",
  email: "daniel.tan@example.com",
  phoneCountryCode: "65",
  phoneNumber: "91234567",
  passport: { number: "K1234567A", issueCountry: "SG", expiry: "2031-06-01" },
} as const;
