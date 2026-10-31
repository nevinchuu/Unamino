import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MuseChatModel } from "@/infrastructure/muse/muse-chat-model";
import { museConfigFromEnv } from "@/infrastructure/muse/muse-config";
import { MuseHttp } from "@/infrastructure/muse/muse-http";
import { nudgeUserMessage, NUDGE_SYSTEM_PROMPT, settleNudge, type NudgeFacts } from "./nudge";

/**
 * Asks the real Muse model to word a few nudges, so it costs a few cents and is skipped unless asked for:
 *   MUSE_LIVE=1 MUSE_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run nudge.live
 * It uses made-up people and a made-up plan only. The wording it got is written to the file so it can be read.
 */
const LIVE = process.env.MUSE_LIVE === "1";
const OUT = process.env.MUSE_LIVE_OUT;
const report: string[] = [];
const GROUP = ["Nev", "Leo", "Dan", "Priya"];

const base: NudgeFacts = {
  name: "Leo",
  sender: "Nev",
  step: "agree",
  shareText: "$142.00",
  minutesLeft: 38,
  hotel: "Travelodge Sukhumvit 11, Superior Room",
  freeToCancel: true,
  others: ["Dan", "Priya"],
  chat: [
    { from: "Leo", text: "I'd really need a room to myself" },
    { from: "Nev", text: "Trippy, plan Bangkok for Dec 11 to 13" },
    { from: "Trippy", text: "Here is a plan with a room each." },
  ],
};

const CASES: readonly { readonly label: string; readonly facts: NudgeFacts }[] = [
  { label: "agree, room need met", facts: base },
  { label: "approve, free cancellation needed", facts: { ...base, name: "Dan", step: "approve", shareText: "$64.22", chat: [{ from: "Dan", text: "Hotel has to be free to cancel" }] } },
  { label: "agree, worried about price", facts: { ...base, name: "Priya", chat: [{ from: "Priya", text: "hmm that feels pricey to me" }], minutesLeft: null } },
];

describe.skipIf(!LIVE)("nudges against the real model", () => {
  const config = museConfigFromEnv(process.env);

  it.each(CASES)("words a nudge: $label", { timeout: 120_000 }, async ({ facts: given }) => {
    // Everyone else in the made-up group, so the person is never listed among the people not to name.
    const facts: NudgeFacts = { ...given, others: GROUP.filter((name) => name !== given.name && name !== given.sender) };
    if (!config.ok) throw new Error(config.error.message);
    const model = new MuseChatModel(new MuseHttp(config.value));
    const answered = await model.turn({
      system: NUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: nudgeUserMessage(facts) }],
      tools: [{ name: "write_nudge", description: "Write the short nudge for this one person. Call this exactly once.", parameters: { type: "object", properties: { say: { type: "string" } }, required: ["say"] } }],
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const raw = answered.value.toolCalls[0] ? (JSON.parse(answered.value.toolCalls[0].arguments) as { say?: string }).say ?? null : answered.value.text;
    const settled = settleNudge(facts, raw);
    report.push(`[${facts.name}] ${raw}\n  -> ${settled === null ? "REJECTED, plain wording would be used" : "accepted"}`);
    if (OUT) writeFileSync(OUT, report.join("\n\n"));
    expect(raw).not.toBeNull();
  });
});
