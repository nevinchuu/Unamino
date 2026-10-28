import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { museConfigFromEnv } from "./muse-config";
import { MuseHttp, type MuseUsage } from "./muse-http";
import { MuseResearcher } from "./muse-researcher";

/**
 * Talks to the real Muse web search, so it costs 2 to 3 cents and is skipped unless asked for:
 *   MUSE_LIVE=1 MUSE_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run muse-research.live
 * It asks one general travel question and never sends traveller data.
 */
const LIVE = process.env.MUSE_LIVE === "1";

describe.skipIf(!LIVE)("MuseResearcher against the real web search", () => {
  // Describe bodies run even when skipped, so a missing key must not throw here.
  const config = museConfigFromEnv(process.env);
  const usages: MuseUsage[] = [];
  const http = new MuseHttp({ ...(config.ok ? config.value : { apiKey: "" }), onUsage: (usage) => usages.push(usage) });
  const researcher = new MuseResearcher(http);

  it("answers a travel question and names pages it read", { timeout: 120_000 }, async () => {
    if (!config.ok) throw new Error(config.error.message);
    const result = await researcher.research("What is Bangkok like in mid December: weather and any festivals?", new Date().toISOString().slice(0, 10));

    const out = process.env.MUSE_LIVE_OUT;
    if (out) writeFileSync(out, JSON.stringify({ result, usages }, null, 2));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.answer.length).toBeGreaterThan(50);
    expect(result.value.sources.length).toBeGreaterThan(0);
    for (const source of result.value.sources) expect(source.url.startsWith("https://")).toBe(true);
  });
});
