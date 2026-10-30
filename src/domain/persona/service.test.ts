import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { PersonaError, PersonaStore } from "./ports";
import type { PersonaProfile } from "./profiles";
import { PersonaService } from "./service";

const actor: Member = { id: "m1", groupId: "g1", displayName: "Judge", currency: "USD", isOrganiser: true };

class FakeStore implements PersonaStore {
  present: string[] = [];
  refuse: PersonaError | null = null;
  async add(groupId: string, personas: readonly PersonaProfile[]): Promise<Result<readonly Member[], PersonaError>> {
    if (this.refuse) return err(this.refuse);
    const fresh = personas.filter((persona) => !this.present.includes(persona.key));
    this.present.push(...fresh.map((persona) => persona.key));
    return ok(fresh.map((persona) => ({ id: persona.key, groupId, displayName: persona.name, currency: "USD", isOrganiser: false, personaKey: persona.key })));
  }
  async addedKeys() {
    return this.present;
  }
  async messagesSince() {
    return 0;
  }
}

const setup = () => {
  const store = new FakeStore();
  const lines: string[] = [];
  const service = new PersonaService({ store, messages: { postSystem: async (_group, body) => (lines.push(body), err({ code: "unavailable", message: "unused" })) } });
  return { store, lines, service };
};

describe("PersonaService", () => {
  it("adds the chosen personas and tells the group once, in plain words", async () => {
    const { service, lines } = setup();
    const added = await service.add(actor, ["maya", "leo"]);
    expect(added.ok && added.value.map((member) => member.displayName)).toEqual(["Maya", "Leo"]);
    expect(lines).toEqual(["Maya and Leo joined as test personas."]);
  });

  it("says nothing when everyone chosen was already there", async () => {
    const { service, lines } = setup();
    await service.add(actor, ["maya"]);
    lines.length = 0;
    const again = await service.add(actor, ["maya"]);
    expect(again).toEqual({ ok: true, value: [] });
    expect(lines).toEqual([]);
  });

  it("refuses an empty choice and a persona that does not exist, adding nobody", async () => {
    const { service, store } = setup();
    expect(await service.add(actor, [])).toMatchObject({ ok: false, error: { kind: "none_chosen" } });
    expect(await service.add(actor, ["maya", "nobody"])).toMatchObject({ ok: false, error: { kind: "unknown_persona" } });
    expect(store.present).toEqual([]);
  });

  it("passes on the store's refusal, and says nothing in the chat", async () => {
    const { service, store, lines } = setup();
    store.refuse = { kind: "full", message: "No room" };
    expect(await service.add(actor, ["maya"])).toMatchObject({ ok: false, error: { kind: "full" } });
    expect(lines).toEqual([]);
  });

  it("ignores a persona named twice", async () => {
    const { service } = setup();
    const added = await service.add(actor, ["dan", "dan"]);
    expect(added.ok && added.value).toHaveLength(1);
  });

  it("lists every preset, marking those already in the group", async () => {
    const { service } = setup();
    await service.add(actor, ["leo"]);
    const choices = await service.choices("g1");
    expect(choices.map((choice) => [choice.key, choice.added])).toEqual([["maya", false], ["leo", true], ["priya", false], ["dan", false]]);
  });
});
