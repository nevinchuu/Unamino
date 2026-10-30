import type { ChatModel } from "@/domain/agent/loop/model";
import type { GroupRepository, MessageRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";
import { decidePersonaTurn, settleWithoutModel, type PersonaInput, type PersonaTurn, type Situation } from "./persona-brain";
import type { PersonaStore } from "./ports";
import { personaByKey } from "./profiles";

/** The most chat messages one group's personas may write in an hour. A persona costs a model call each time it speaks. */
export const MAX_PERSONA_MESSAGES_PER_HOUR = 40;
const HOUR_MS = 3_600_000;
/** How much of the chat a persona is shown. */
const CHAT_WINDOW = 12;

export interface PersonaRunnerDeps {
  readonly groups: Pick<GroupRepository, "joinedMembers" | "memberNames">;
  readonly messages: Pick<MessageRepository, "recent" | "post">;
  readonly store: Pick<PersonaStore, "messagesSince">;
  readonly model: () => ChatModel;
  readonly clock: () => Date;
}

/** Decides what the test personas of a group say and do, and writes what they say. It never acts for a real person, and never calls Trippy: a persona's words carry no mention. */
export class PersonaRunner {
  constructor(private readonly deps: PersonaRunnerDeps) {}

  /** Each of these personas says hello, one after the other, so the chat reads as people arriving. */
  async introduce(groupId: string, personas: readonly Member[]): Promise<void> {
    for (const persona of personas) {
      const turn = await this.decide(groupId, persona, "intro");
      if (turn?.say) await this.say(groupId, persona, turn.say);
    }
  }

  /** Writes what a persona says into the chat, in their own name. */
  async say(groupId: string, persona: Member, text: string): Promise<void> {
    await this.deps.messages.post({ groupId, memberId: persona.id, body: text });
  }

  /**
   * What one persona says and does in this situation, not yet written anywhere, so the caller can word it differently
   * (a request for changes carries the words inside the request). Null when the persona is rate-limited or unknown.
   */
  async decide(groupId: string, persona: Member, situation: Situation, overrides: Partial<Pick<PersonaInput, "plan" | "verdict">> = {}): Promise<PersonaTurn | null> {
    const profile = persona.personaKey ? personaByKey(persona.personaKey) : undefined;
    if (!profile) return null;
    const now = this.deps.clock();
    if ((await this.deps.store.messagesSince(groupId, new Date(now.getTime() - HOUR_MS))) >= MAX_PERSONA_MESSAGES_PER_HOUR) return null;

    const [people, names, recent] = await Promise.all([this.deps.groups.joinedMembers(groupId), this.deps.groups.memberNames(groupId), this.deps.messages.recent(groupId, CHAT_WINDOW)]);
    const input: PersonaInput = {
      profile,
      situation,
      today: now.toISOString().slice(0, 10),
      others: [...people.filter((member) => member.id !== persona.id).map((member) => member.displayName), "Trippy"],
      chat: recent.map((message) => ({ from: message.kind === "agent" ? "Trippy" : message.kind === "system" ? "App" : (names.get(message.memberId ?? "") ?? "Someone"), text: message.body })),
      plan: null,
      verdict: { ok: true },
      ...overrides,
    };
    const decided = await decidePersonaTurn(this.deps.model(), input);
    // A model that cannot be reached must not stall the plan: the persona still acts, in plain words.
    return decided.ok ? decided.value : settleWithoutModel(input);
  }
}
