import type { Result } from "@/lib/result";

/** A page the answer came from. */
export interface ResearchSource {
  readonly title: string;
  readonly url: string;
}

export interface Research {
  /** Plain text, written from what the web said. */
  readonly answer: string;
  readonly sources: readonly ResearchSource[];
}

/** "unavailable": the search could not be done. */
export interface ResearchError {
  readonly code: "unavailable";
  readonly message: string;
}

/** Looks a question up on the web and answers it. Muse Spark's own web search implements this; tests use a scripted one. */
export interface WebResearcher {
  /** `today` is a calendar date (YYYY-MM-DD), so "next month" and "this year" mean the right ones. */
  research(question: string, today: string): Promise<Result<Research, ResearchError>>;
}

/** The site a page is on, without "www.", for naming a source in plain words. Empty if it is not an address. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
