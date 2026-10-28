import "server-only";
import { err, ok, type Result } from "@/lib/result";
import type { Research, ResearchError, WebResearcher } from "@/domain/agent/loop/research";
import type { MuseHttp } from "./muse-http";

/** Everything the search does counts against this: the queries, the pages it reads and the answer. */
const RESEARCH_TOKENS = 8_000;

/** Researches a question with Muse Spark's own built-in web search. */
export class MuseResearcher implements WebResearcher {
  constructor(private readonly muse: Pick<MuseHttp, "research">) {}

  async research(question: string, today: string): Promise<Result<Research, ResearchError>> {
    const found = await this.muse.research({ question, today, maxTokens: RESEARCH_TOKENS });
    if (!found.ok) return err({ code: "unavailable", message: found.error.message });
    return ok({ answer: found.value.text, sources: found.value.sources });
  }
}
