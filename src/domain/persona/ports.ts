import type { Result } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { PersonaProfile } from "./profiles";

export type PersonaErrorKind = "full" | "none_chosen" | "unknown_persona" | "too_many" | "unavailable";

export interface PersonaError {
  readonly kind: PersonaErrorKind;
  readonly message: string;
}

export interface PersonaStore {
  /**
   * Puts these personas in the group as members, skipping any already there, and returns the ones newly added. All or
   * nothing: if there is no room for them, none are added.
   */
  add(groupId: string, personas: readonly PersonaProfile[], maxPersonas: number): Promise<Result<readonly Member[], PersonaError>>;
  /** The personas currently in the group, by key. */
  addedKeys(groupId: string): Promise<readonly string[]>;
  /** How many chat messages the group's personas have written since a moment, for the limit on how much they talk. */
  messagesSince(groupId: string, since: Date): Promise<number>;
}
