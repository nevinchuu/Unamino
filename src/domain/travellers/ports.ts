import type { Result } from "@/lib/result";

/** "unavailable": the store could not be reached. */
export interface TravellerStoreError {
  readonly code: "unavailable";
  readonly message: string;
}

/** Keeps each member's encrypted details. It never sees them in the clear. */
export interface TravellerStore {
  /** Saves the details, replacing any the member saved before. */
  put(memberId: string, ciphertext: string): Promise<Result<void, TravellerStoreError>>;
  /** The member's encrypted details, or null if they have not given any. */
  get(memberId: string): Promise<Result<string | null, TravellerStoreError>>;
  /** Which of these members have given their details. */
  haveDetails(memberIds: readonly string[]): Promise<Result<readonly string[], TravellerStoreError>>;
  /** Deletes the details of these members. Deleting ones that are not there is fine. */
  remove(memberIds: readonly string[]): Promise<Result<void, TravellerStoreError>>;
  /** Deletes every set of details last given before `before`, whoever they belong to. Returns how many went. */
  removeOlderThan(before: Date): Promise<Result<number, TravellerStoreError>>;
}

/** "tampered": the text was changed, belongs to someone else, or was made with another key. */
export interface CipherError {
  readonly code: "tampered";
}

/**
 * Locks and unlocks text. `context` ties the result to what it is about (the member), so a locked value copied
 * onto another member's row does not open.
 */
export interface TravellerCipher {
  encrypt(plaintext: string, context: string): string;
  decrypt(token: string, context: string): Result<string, CipherError>;
}
