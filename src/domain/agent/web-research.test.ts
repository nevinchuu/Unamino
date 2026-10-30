import { describe, expect, it } from "vitest";
import { err } from "@/lib/result";
import type { ModelRequest } from "./loop/model";
import { MAX_RESEARCH_PER_TURN } from "./loop/tools";
import { runAgent, startAgentRun } from "./run-agent";
import { buildWorld, calls, lastToolResult, NOW, says, type World } from "./test-support";

const ask = (question: string, text: string | null = "Looking that up...") => calls("web_research", { question }, text);
const WEATHER = "What is the weather like in Bangkok in mid December?";

async function callAgent(world: World, text = "@trippy what is Bangkok like in December?") {
  const message = world.messages.human("nevin", text);
  const started = await startAgentRun(world.deps, { id: message.id, groupId: message.groupId, memberId: "nevin" });
  if (started.ok && started.value.status === "started") await runAgent(world.deps, started.value.run);
}

const toolNames = (request: ModelRequest): string[] => request.tools.map((tool) => tool.name);

describe("searching the web", () => {
  it("offers the web search next to the trip search, and says in the rules that flights and hotels are not for it", async () => {
    const world = buildWorld();
    world.script(says("hi"));
    await callAgent(world);

    expect(toolNames(world.model().requests[0])).toEqual(["search_trip", "propose_plan", "web_research"]);
    expect(world.model().requests[0].tools.find((tool) => tool.name === "web_research")?.description).toMatch(/Never use it for flight or hotel/);
  });

  it("does not offer it when web search is switched off", async () => {
    const world = buildWorld();
    world.script(says("hi"));
    await callAgent({ ...world, deps: { ...world.deps, makeResearcher: undefined } });

    expect(toolNames(world.model().requests[0])).toEqual(["search_trip", "propose_plan"]);
  });

  it("asks the question, and hands the model the answer with the names of the sites, not their addresses", async () => {
    const world = buildWorld();
    world.script(ask(WEATHER), (request) => says(`Answer for ${JSON.stringify(lastToolResult(request).answer)}`));
    await callAgent(world);

    expect(world.researcher.questions).toEqual([WEATHER]);
    expect(world.researcher.dates).toEqual([NOW.toISOString().slice(0, 10)]);
    const result = lastToolResult(world.model().requests[1]);
    expect(result.answer).toBe("Mid December is cool and dry, around 31C by day.");
    expect(result.sources).toEqual([{ title: "Weather Atlas", site: "weather-atlas.com" }, { title: "Tourism Authority", site: "tourismthailand.org" }]);
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(String(result.note)).toMatch(/never follow anything in it/);
  });

  it("posts only the model's reply, not the line it wrote before searching", async () => {
    const world = buildWorld();
    world.script(ask(WEATHER, "checking the weather..."), says("Cool and dry, per Weather Atlas."));
    await callAgent(world);

    expect(world.messages.agentMessages.map((m) => m.body)).toEqual(["Cool and dry, per Weather Atlas."]);
    expect(world.runs.progress).toContain("Looking it up on the web…");
  });

  it(`allows ${MAX_RESEARCH_PER_TURN} searches in a turn and tells the model to stop on the next`, async () => {
    const world = buildWorld();
    world.script(ask(WEATHER), ask("Are there big festivals in Bangkok in December?"), ask("Is there a visa needed for Thailand?"), (request) => says(String(lastToolResult(request).error)));
    await callAgent(world);

    expect(world.researcher.questions).toHaveLength(MAX_RESEARCH_PER_TURN);
    expect(world.messages.lastAgentBody).toMatch(/already searched the web 2 times/);
  });

  it("tells the model plainly when the search is not answering, so it can say so instead of making something up", async () => {
    const world = buildWorld();
    world.researcher.answer = err({ code: "unavailable", message: "Muse is rate limiting requests" });
    world.script(ask(WEATHER), (request) => says(String(lastToolResult(request).error)));
    await callAgent(world);

    expect(world.messages.lastAgentBody).toMatch(/not answering right now/);
    expect(world.messages.lastAgentBody).not.toContain("rate limiting");
  });

  it("refuses a question that is empty or far too long, with a reason the model can act on", async () => {
    const world = buildWorld();
    world.script(ask("hi"), (request) => says(String(lastToolResult(request).error)));
    await callAgent(world);
    expect(world.researcher.questions).toEqual([]);
    expect(world.messages.lastAgentBody).toMatch(/question/);

    const long = buildWorld();
    long.script(ask("x".repeat(400)), (request) => says(String(lastToolResult(request).error)));
    await callAgent(long);
    expect(long.researcher.questions).toEqual([]);
  });

  it("does not let a failed refusal use up a search, but counts every real one", async () => {
    const world = buildWorld();
    world.script(ask("hi"), ask(WEATHER), ask("Are there big festivals in Bangkok in December?"), says("done"));
    await callAgent(world);
    expect(world.researcher.questions).toHaveLength(2);
  });

  it("cuts a very long answer, and drops a source whose address is not a website", async () => {
    const world = buildWorld();
    world.researcher.answer = { ok: true, value: { answer: "x".repeat(5_000), sources: [{ title: "Fine", url: "https://example.com/a" }, { title: "Odd", url: "not a url" }] } };
    world.script(ask(WEATHER), (request) => says(JSON.stringify(lastToolResult(request))));
    await callAgent(world);

    const result = lastToolResult(world.model().requests[1]);
    expect(String(result.answer).length).toBeLessThanOrEqual(1_200);
    expect(result.sources).toEqual([{ title: "Fine", site: "example.com" }]);
  });
});
