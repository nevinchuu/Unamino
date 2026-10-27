import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TraceSink } from "@/domain/agent/trace";

const TRACE_DIR = ".muse-trace";
const TRACE_FILE = "trace.jsonl";

/**
 * Appends each event as one JSON line to `.muse-trace/trace.jsonl` (gitignored). Only on when MUSE_TRACE=1, and
 * never in production, since a trace holds the group's chat and the model's raw answers.
 */
export function traceSinkFromEnv(env: Readonly<Record<string, string | undefined>>, cwd: string = process.cwd()): TraceSink | undefined {
  if (env.MUSE_TRACE !== "1" || env.NODE_ENV === "production") return undefined;
  const dir = join(cwd, TRACE_DIR);
  return (event) => {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, TRACE_FILE), `${JSON.stringify(event)}\n`);
    } catch {
      // A trace that cannot be written is simply missing.
    }
  };
}
