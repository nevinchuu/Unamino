import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceSinkFromEnv } from "./file-trace";

const event = { at: "2026-10-27T10:00:00.000Z", source: "agent", stage: "decision", data: { a: 1 } } as const;
const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("traceSinkFromEnv", () => {
  it("is off unless MUSE_TRACE is 1", () => {
    expect(traceSinkFromEnv({})).toBeUndefined();
    expect(traceSinkFromEnv({ MUSE_TRACE: "true" })).toBeUndefined();
  });

  it("is never on in production", () => {
    expect(traceSinkFromEnv({ MUSE_TRACE: "1", NODE_ENV: "production" })).toBeUndefined();
  });

  it("appends one JSON line per event", () => {
    const cwd = tempDir();
    const sink = traceSinkFromEnv({ MUSE_TRACE: "1" }, cwd);
    sink?.(event);
    sink?.({ ...event, stage: "next" });
    const lines = readFileSync(join(cwd, ".muse-trace", "trace.jsonl"), "utf-8").trim().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as { stage: string }).stage)).toEqual(["decision", "next"]);
  });

  it("does not throw when it cannot write", () => {
    const sink = traceSinkFromEnv({ MUSE_TRACE: "1" }, "Z:/no/such/drive\0bad");
    expect(() => sink?.(event)).not.toThrow();
  });
});
