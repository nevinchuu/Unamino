import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";

const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_MODEL = "muse-spark-1.3";
/** A reasoning model thinks before it answers, so a call can legitimately take a while. */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";
/** The most an answer may be given. Reasoning tokens are counted too and are billed as output. */
const MAX_TOKEN_CEILING = 32_000;
const TRUNCATION_RETRY_FACTOR = 2;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const MAX_DETAIL_LENGTH = 200;

export type ReasoningEffort = "low" | "medium" | "high";

export interface MuseUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Part of `completionTokens` spent thinking. Billed like any other output. */
  readonly reasoningTokens: number;
}

export interface MuseConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly fetchImpl?: typeof fetch;
  /** Called once per request that reached Muse, including a truncated attempt, so cost can be logged. */
  readonly onUsage?: (usage: MuseUsage, model: string) => void;
  /** Called once per attempt with exactly what was sent and what came back, for a developer's trace. Never gets the key. */
  readonly onTrace?: (call: MuseCall) => void;
}

/** One request to Muse and its raw outcome. `raw` is the whole response body, so any field the service adds shows up. */
export interface MuseCall {
  readonly task: string;
  readonly maxTokens: number;
  readonly system: string;
  readonly user: string;
  readonly status: number | null;
  readonly durationMs: number;
  readonly raw: unknown;
  readonly problem: string | null;
}

/** The task name the prompt put in its user message, or "unknown". */
function taskOf(user: string): string {
  try {
    const task = (JSON.parse(user) as { task?: unknown }).task;
    return typeof task === "string" ? task : "unknown";
  } catch {
    return "unknown";
  }
}

export interface CompletionRequest {
  readonly system: string;
  /** What the model works on. Untrusted text belongs here as quoted data, never in `system`. */
  readonly user: string;
  /** The answer and the model's thinking share this budget. */
  readonly maxTokens: number;
}

export interface Completion {
  readonly text: string;
  readonly model: string;
  readonly usage: MuseUsage;
}

/**
 * "unavailable": the call failed or was refused by the service; worth reporting, not worth feeding back.
 * "truncated": even a doubled budget ended before the answer did.
 * "refused": the model declined to answer.
 * "invalid_response": the service answered in a shape we do not recognise.
 */
export type MuseErrorCode = "unavailable" | "truncated" | "refused" | "invalid_response";

export interface MuseError {
  readonly code: MuseErrorCode;
  readonly message: string;
}

const fail = (code: MuseErrorCode, message: string): Result<never, MuseError> => err({ code, message });

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional(),
    })
    .optional(),
});

type ParsedResponse = z.infer<typeof responseSchema>;

const turnResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) })).nullish(),
        }),
      }),
    )
    .min(1),
  usage: responseSchema.shape.usage,
});

/** A message in a conversation, in the shape the API takes. */
export type ConversationMessage =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls?: readonly { readonly id: string; readonly type: "function"; readonly function: { readonly name: string; readonly arguments: string } }[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export interface ConversationTool {
  readonly type: "function";
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> };
}

export interface ConversationRequest {
  readonly system: string;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ConversationTool[];
  readonly maxTokens: number;
}

/** What the model said, and the tools it asked to use. `arguments` is the raw JSON text the model wrote. */
export interface ConversationTurn {
  readonly text: string | null;
  readonly toolCalls: readonly { readonly id: string; readonly name: string; readonly arguments: string }[];
}

const errorBodySchema = z.object({ error: z.object({ message: z.string().optional() }).optional() });

/** The service's own explanation of a refused request, shortened and with our key blanked out in case it echoes it. */
function errorDetail(body: unknown, apiKey: string): string {
  const message = errorBodySchema.safeParse(body).data?.error?.message;
  return message ? message.replaceAll(apiKey, "[redacted]").slice(0, MAX_DETAIL_LENGTH) : "no details given";
}

const toUsage = (response: ParsedResponse): MuseUsage => ({
  promptTokens: response.usage?.prompt_tokens ?? 0,
  completionTokens: response.usage?.completion_tokens ?? 0,
  reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
});

/**
 * The one place that talks to the Meta Model API. It asks for JSON, gives a call that runs out of tokens one
 * retry with a bigger budget, and never puts the API key in an error message.
 */
export class MuseHttp {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: MuseConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.reasoningEffort = config.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Asks for a JSON answer. Retries once with double the budget if the first ran out before finishing. */
  async complete(request: CompletionRequest): Promise<Result<Completion, MuseError>> {
    const first = await this.attempt(request, request.maxTokens);
    if (first.ok || first.error.code !== "truncated") return first;

    const biggerBudget = Math.min(request.maxTokens * TRUNCATION_RETRY_FACTOR, MAX_TOKEN_CEILING);
    if (biggerBudget <= request.maxTokens) return first;
    return this.attempt(request, biggerBudget);
  }

  private async attempt(request: CompletionRequest, maxTokens: number): Promise<Result<Completion, MuseError>> {
    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      reasoning_effort: this.reasoningEffort,
    };
    return this.traced(taskOf(request.user), request.system, request.user, maxTokens, payload, (body) => this.readCompletion(body));
  }

  /** Sends one payload, reports it to the trace, and reads the answer with `read`. */
  private async traced<T>(task: string, system: string, user: string, maxTokens: number, payload: unknown, read: (body: unknown) => Result<T, MuseError>): Promise<Result<T, MuseError>> {
    const startedAt = Date.now();
    let status: number | null = null;
    let raw: unknown = null;
    const result = await this.post(payload, (code, body) => {
      status = code;
      raw = body;
    }, read);
    this.config.onTrace?.({ task, maxTokens, system, user, status, durationMs: Date.now() - startedAt, raw, problem: result.ok ? null : `${result.error.code}: ${result.error.message}` });
    return result;
  }

  private async post<T>(payload: unknown, seen: (status: number, raw: unknown) => void, read: (body: unknown) => Result<T, MuseError>): Promise<Result<T, MuseError>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return fail("unavailable", "Muse did not respond in time");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return response.ok
        ? fail("invalid_response", "Muse returned a response that is not JSON")
        : fail("unavailable", `Muse returned an error (${response.status})`);
    }
    seen(response.status, body);
    if (!response.ok) return this.failureFor(response.status, body);
    return read(body);
  }

  /**
   * A free-form turn: the model may answer in plain text, ask to use tools, or both. No JSON mode. Gets the same
   * one retry with a bigger budget when it runs out of tokens (its thinking shares the budget).
   */
  async converse(request: ConversationRequest): Promise<Result<ConversationTurn, MuseError>> {
    const first = await this.converseOnce(request, request.maxTokens);
    if (first.ok || first.error.code !== "truncated") return first;
    const biggerBudget = Math.min(request.maxTokens * TRUNCATION_RETRY_FACTOR, MAX_TOKEN_CEILING);
    return biggerBudget <= request.maxTokens ? first : this.converseOnce(request, biggerBudget);
  }

  private converseOnce(request: ConversationRequest, maxTokens: number): Promise<Result<ConversationTurn, MuseError>> {
    const payload = {
      model: this.model,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      ...(request.tools.length > 0 && { tools: request.tools, tool_choice: "auto" }),
      max_tokens: maxTokens,
      reasoning_effort: this.reasoningEffort,
    };
    // The trace shows the whole conversation so far, since each turn is judged by everything before it.
    return this.traced("converse", request.system, JSON.stringify(request.messages), maxTokens, payload, (body) => this.readTurn(body));
  }

  private readTurn(body: unknown): Result<ConversationTurn, MuseError> {
    const parsed = turnResponseSchema.safeParse(body);
    if (!parsed.success) return fail("invalid_response", "Muse response did not match the expected shape");
    this.config.onUsage?.(toUsage(parsed.data), parsed.data.model ?? this.model);

    const [choice] = parsed.data.choices;
    if (choice.finish_reason === "length") return fail("truncated", "Muse ran out of tokens before finishing its answer");
    if (choice.message.refusal) return fail("refused", "Muse declined to answer");
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
    const text = choice.message.content?.trim() || null;
    if (text === null && toolCalls.length === 0) return fail("invalid_response", "Muse returned no answer");
    return ok({ text, toolCalls });
  }

  private failureFor(status: number, body: unknown): Result<never, MuseError> {
    if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) return fail("unavailable", "Muse rejected the API key");
    if (status === HTTP_TOO_MANY_REQUESTS) return fail("unavailable", "Muse is rate limiting requests, try again shortly");
    if (status >= HTTP_SERVER_ERROR) return fail("unavailable", `Muse had an error (${status})`);
    return fail("unavailable", `Muse refused the request (${status}): ${errorDetail(body, this.config.apiKey)}`);
  }

  private readCompletion(body: unknown): Result<Completion, MuseError> {
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) return fail("invalid_response", "Muse response did not match the expected shape");

    const usage = toUsage(parsed.data);
    const model = parsed.data.model ?? this.model;
    this.config.onUsage?.(usage, model);

    const [choice] = parsed.data.choices;
    // Running out of tokens leaves empty or cut-off text, so it is judged before the text is looked at.
    if (choice.finish_reason === "length") return fail("truncated", "Muse ran out of tokens before finishing its answer");
    if (choice.message.refusal) return fail("refused", "Muse declined to answer");
    const text = choice.message.content;
    if (typeof text !== "string" || text.trim() === "") return fail("invalid_response", "Muse returned no answer");
    return ok({ text, model, usage });
  }
}
