import { writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent, startAgentRun, type AgentDeps } from "@/domain/agent/run-agent";
import { StaticFxRates } from "@/domain/agent/static-fx";
import type { Member } from "@/domain/group/types";
import { connectDatabase, type DatabaseHandle } from "./db/client";
import { PostgresBriefRepository } from "./db/postgres-brief-repository";
import { PostgresConstraintRepository } from "./db/postgres-constraint-repository";
import { PostgresGroupRepository } from "./db/postgres-group-repository";
import { PostgresMessageRepository } from "./db/postgres-message-repository";
import { PostgresPlanRepository } from "./db/postgres-plan-repository";
import { PostgresPlanStore } from "./db/postgres-plan-store";
import { PostgresRunRepository } from "./db/postgres-run-repository";
import { PostgresSearchStore } from "./db/postgres-search-store";
import { agentRuns, groups, planMembers, planPicks, plans, scheduleSuggestions } from "./db/schema";
import { GooglePlacesLookup } from "./google-places/places-lookup";
import { LiteApiOfferSource } from "./liteapi/liteapi-offer-source";
import { museConfigFromEnv } from "./muse/muse-config";
import { MuseHttp, type Completion, type CompletionRequest, type MuseError } from "./muse/muse-http";
import type { Result } from "@/lib/result";
import { MusePlanner, type CompletionClient } from "./muse/muse-planner";

/**
 * The whole product path with nothing faked except the people: a group chat in the real database, the real Muse
 * model, the real liteAPI sandbox and real Google Places. It costs a few cents and is skipped unless asked for:
 *   AGENT_LIVE=1 AGENT_LIVE_OUT=<file> node --env-file=.env.local node_modules/vitest/vitest.mjs run agent.live
 */
const LIVE = process.env.AGENT_LIVE === "1";

describe.skipIf(!LIVE)("the agent end to end on real services", () => {
  let handle: DatabaseHandle;
  let groupId = "";
  const report: Record<string, unknown> = {};
  const exchanges: { user: string; reply: Result<Completion, MuseError> }[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = connectDatabase(url, 10);
  });

  afterAll(async () => {
    if (!handle) return;
    report.exchanges = exchanges;
    if (process.env.AGENT_LIVE_OUT) writeFileSync(process.env.AGENT_LIVE_OUT, JSON.stringify(report, null, 2));
    if (groupId) {
      await handle.db.delete(plans).where(eq(plans.groupId, groupId));
      await handle.db.delete(groups).where(eq(groups.id, groupId));
    }
    await handle.close();
  }, 60_000);

  it("takes a real chat to a real plan, then fits a friend in", { timeout: 900_000 }, async () => {
    const museConfig = museConfigFromEnv(process.env);
    if (!museConfig.ok) throw new Error(museConfig.error.message);
    const liteKey = process.env.LITEAPI_KEY;
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!liteKey || !placesKey) throw new Error("LITEAPI_KEY and GOOGLE_PLACES_API_KEY are needed");

    const { db } = handle;
    const groupRepo = new PostgresGroupRepository(db);
    const messageRepo = new PostgresMessageRepository(db);
    const planStore = new PostgresPlanStore(db);
    const deps: AgentDeps = {
      groups: groupRepo,
      messages: messageRepo,
      runs: new PostgresRunRepository(db),
      briefs: new PostgresBriefRepository(db),
      constraints: new PostgresConstraintRepository(db),
      searches: new PostgresSearchStore(db),
      plans: planStore,
      planRepository: new PostgresPlanRepository(db),
      offers: new LiteApiOfferSource({ apiKey: liteKey, currency: "USD", guestNationality: "SG", timeoutMs: 45_000 }),
      venues: new GooglePlacesLookup({ apiKey: placesKey }),
      fx: new StaticFxRates(),
      makePlanner: (meter) => {
        const http = new MuseHttp({ ...museConfig.value, onUsage: (usage) => meter.add(usage) });
        // Keeps what Muse was asked and what it said, so a failed run can be understood afterwards.
        const client: CompletionClient = {
          async complete(request: CompletionRequest) {
            const reply = await http.complete(request);
            exchanges.push({ user: request.user.includes("propose_plan") ? request.user : request.user.slice(0, 300), reply });
            return reply;
          },
        };
        return new MusePlanner(client);
      },
      clock: () => new Date(),
    };

    const created = await groupRepo.create({ name: "live-test-group", baseCurrency: "USD", organiser: { displayName: "Nevin", currency: "USD" } });
    if (!created.ok) throw new Error(created.error.message);
    groupId = created.value.group.id;
    const people: Member[] = [created.value.organiser];
    for (const name of ["Ana", "Ben", "Jia"]) {
      const joined = await groupRepo.joinWithLink(created.value.joinToken, { displayName: name, currency: "USD" });
      if (!joined.ok) throw new Error(joined.error.message);
      people.push(joined.value.member);
    }
    const say = async (member: Member, body: string) => {
      const posted = await messageRepo.post({ groupId, memberId: member.id, body });
      if (!posted.ok) throw new Error(posted.error.message);
      return posted.value;
    };
    const call = async (member: Member, body: string) => {
      const message = await say(member, body);
      const started = await startAgentRun(deps, { id: message.id, groupId, memberId: member.id });
      if (!started.ok || started.value.status !== "started") throw new Error("the run did not start");
      await runAgent(deps, started.value.run);
    };
    const lastAgentMessage = async () => (await messageRepo.recent(groupId, 5)).filter((m) => m.kind === "agent").at(-1);

    // A normal chat: people talk, and the agent is mentioned once.
    await say(people[1], "I can only fly after 6pm on Friday");
    await say(people[2], "Max $350 for me");
    await say(people[3], "I'd like my own room. Not into cooking classes");
    await call(people[0], "@agent plan Bangkok for us, leaving Fri 11 Dec and back Sun 13 Dec. We all fly from Singapore");

    const first = await planStore.latest(groupId);
    const firstMessage = await lastAgentMessage();
    report.first = { plan: first, announcement: firstMessage?.body };
    expect(first).toMatchObject({ status: "reviewing", headcount: 4 });
    report.firstPicks = (await db.select().from(planPicks).where(eq(planPicks.planId, first?.id ?? ""))).map((p) => ({ title: (p.offer as { title: string }).title, members: p.memberIds.length, reason: p.reason }));
    report.firstSuggestions = (await db.select().from(scheduleSuggestions).where(eq(scheduleSuggestions.planId, first?.id ?? ""))).map((s) => ({ venue: (s.venue as { name: string }).name, date: s.date, start: s.startTime, category: s.category }));

    // A fifth person joins and someone asks the agent to fit them in.
    const ravi = await groupRepo.joinWithLink(created.value.joinToken, { displayName: "Ravi", currency: "USD" });
    if (!ravi.ok) throw new Error(ravi.error.message);
    await call(people[1], "@agent Ravi just joined, can you fit him in too?");

    const second = await planStore.latest(groupId);
    const secondMessage = await lastAgentMessage();
    report.second = { plan: second, announcement: secondMessage?.body };
    expect(second).toMatchObject({ status: "reviewing", headcount: 5 });
    expect(second?.id).not.toBe(first?.id);
    const [oldPlan] = await db.select().from(plans).where(eq(plans.id, first?.id ?? ""));
    expect(oldPlan).toMatchObject({ status: "expired", replacedByPlanId: second?.id });
    expect(await db.select().from(planMembers).where(eq(planMembers.planId, second?.id ?? ""))).toHaveLength(5);

    const runs = await db.select().from(agentRuns).where(eq(agentRuns.groupId, groupId));
    report.runs = runs.map((r) => ({ status: r.status, error: r.errorCode, prompt: r.promptTokens, completion: r.completionTokens, reasoning: r.reasoningTokens }));
    expect(runs.every((r) => r.status === "done")).toBe(true);
    // Everything the group said stays visible, in order.
    report.chat = (await messageRepo.recent(groupId, 50)).map((m) => `${m.kind}: ${m.body.split("\n")[0]}`);
    expect(inArray(plans.id, [first?.id ?? "", second?.id ?? ""])).toBeDefined();
  });
});
