import type { MessageKind } from "./types";

/** `@agent` as a word of its own: not inside an email address, and not the start of a longer word like @agents. */
const AGENT_MENTION = /(^|[^\w@])@agent(?![\w-])/i;

export const mentionsAgent = (body: string): boolean => AGENT_MENTION.test(body);

/**
 * Does this message call the agent? Typing `@agent` does, and so does replying to one of the agent's own messages,
 * which is how a group answers its questions. Only people can call it: the agent's and the system's own lines never
 * do, so the agent cannot start itself.
 */
export function callsAgent(input: { readonly kind: MessageKind; readonly body: string; readonly repliesToKind: MessageKind | null }): boolean {
  if (input.kind !== "human") return false;
  return mentionsAgent(input.body) || input.repliesToKind === "agent";
}
