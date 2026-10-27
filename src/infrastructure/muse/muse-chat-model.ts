import { err, ok, type Result } from "@/lib/result";
import type { ChatModel, ModelMessage, ModelRequest, ModelTurn } from "@/domain/agent/loop/model";
import type { PlannerError } from "@/domain/planner/errors";
import type { ConversationMessage, ConversationRequest, ConversationTurn, MuseError } from "./muse-http";

/** Answer budget for one turn. Muse's thinking shares it, and the transport retries once with double. */
const TURN_MAX_TOKENS = 4_000;

/** The part of the transport the chat model needs, so tests can stand in for it. */
export interface ConversationClient {
  converse(request: ConversationRequest): Promise<Result<ConversationTurn, MuseError>>;
}

const toApiMessage = (message: ModelMessage): ConversationMessage => {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls.length > 0 && { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } })) }),
      };
  }
};

/** A call that failed is reported; an answer that was empty or refused can be tried again by the caller. */
const toPlannerError = (error: MuseError): PlannerError =>
  error.code === "unavailable" || error.code === "truncated" ? { code: "planner_unavailable", message: error.message } : { code: "invalid_output", message: error.message };

/** The conversational side of the agent, backed by Meta's Muse model with native tool calling. */
export class MuseChatModel implements ChatModel {
  constructor(private readonly client: ConversationClient) {}

  async turn(request: ModelRequest): Promise<Result<ModelTurn, PlannerError>> {
    const answer = await this.client.converse({
      system: request.system,
      messages: request.messages.map(toApiMessage),
      tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      maxTokens: TURN_MAX_TOKENS,
    });
    return answer.ok ? ok({ text: answer.value.text, toolCalls: answer.value.toolCalls }) : err(toPlannerError(answer.error));
  }
}
