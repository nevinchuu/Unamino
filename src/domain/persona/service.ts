import { err, type Result } from "@/lib/result";
import type { MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import type { PersonaError, PersonaStore } from "./ports";
import { PERSONAS, PERSONAS_PER_GROUP, personaByKey, type PersonaProfile } from "./profiles";

export interface PersonaServiceDeps {
  readonly store: PersonaStore;
  readonly messages: Pick<MessageRepository, "postSystem">;
}

/** What the chooser shows: each preset, and whether it is already in this group. */
export interface PersonaChoice {
  readonly key: string;
  readonly name: string;
  readonly tagline: string;
  readonly added: boolean;
}

const names = (people: readonly string[]): string => (people.length <= 1 ? (people[0] ?? "") : `${people.slice(0, -1).join(", ")} and ${people.at(-1)}`);

/** Lets someone in a group add simulated test personas to it, so a judge can try a group trip alone. */
export class PersonaService {
  constructor(private readonly deps: PersonaServiceDeps) {}

  async choices(groupId: string): Promise<readonly PersonaChoice[]> {
    const added = new Set(await this.deps.store.addedKeys(groupId));
    return PERSONAS.map((persona) => ({ key: persona.key, name: persona.name, tagline: persona.tagline, added: added.has(persona.key) }));
  }

  /** Adds the chosen personas and tells the group in the chat. Returns only those newly added. Anything unknown is refused whole. */
  async add(actor: Member, keys: readonly string[]): Promise<Result<readonly Member[], PersonaError>> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return err({ kind: "none_chosen", message: "Pick at least one persona." });
    const chosen: PersonaProfile[] = [];
    for (const key of unique) {
      const persona = personaByKey(key);
      if (!persona) return err({ kind: "unknown_persona", message: "That persona doesn't exist." });
      chosen.push(persona);
    }

    const added = await this.deps.store.add(actor.groupId, chosen, PERSONAS_PER_GROUP);
    if (!added.ok) return added;
    if (added.value.length > 0) {
      await this.deps.messages.postSystem(actor.groupId, `${names(added.value.map((member) => member.displayName))} joined as test ${added.value.length === 1 ? "persona" : "personas"}.`);
    }
    return added;
  }
}
