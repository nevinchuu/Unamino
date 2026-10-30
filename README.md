# Unamino

**Book a group trip only when everyone is in.** Friends plan in a group chat with an agent called Trippy, built on Meta's Muse Spark. Trippy finds real flights and hotels and proposes a plan. Each person then approves their own capped amount and puts a card **hold** on it. Only when everyone is in are the flights and hotel booked, and only then are the holds charged. If anything fails, the bookings are cancelled and every hold is released. Nobody pays for a trip that did not happen.

The interesting part is not the itinerary. It is the commitment engine behind it: per-person splits, capped holds, and an all-or-nothing booking with a rollback.

Built for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

> **Everything here runs on test data.** Flights and hotels come from the liteAPI sandbox, and cards are in Stripe test mode. No real booking is made and no real money moves. See [Sandbox and test mode](#sandbox-and-test-mode).

## What was written during the hackathon

Everything in this repository was written during the event: the first commit is dated 27 October 2026. Open-source dependencies are listed in `package.json`.

## How it works

1. Someone creates a group and shares one invite link. Everyone chats normally. The **Trips** home lists every group a browser is in, with the last message, an unread dot, who has done their part and how the plan stands.
2. Anyone mentions `@trippy` (or replies to it). Trippy decides for itself what to do: brainstorm, ask one question, look something up on the web, or search and propose a plan.
3. **Step 1, agree.** A panel opens above the message box with the person's own price and an **Agree** button ("2/4 agreed"). No card yet. A person can also tap **I need changes**, which asks Trippy to adjust the plan instead of ending it. Once the trip is booked, a strip under the chat header keeps the plan one tap away, and earlier messages load a page at a time.
4. **Step 2, approve.** Each person approves *their own* amount (a cap), gives traveller details, and adds a card. This places a **hold**, not a charge.
5. **Booking.** When the last hold lands, the hotel and then the flight are booked. Only then is each person charged their share, which can be lower than their cap and never higher.
6. **If anything fails** (a price rises past someone's cap, a flight sells out, the clock runs out), every booking made so far is cancelled and every hold is released.

Each person pays only for what they take part in: a friend who already lives at the destination pays for the hotel, not a flight.

### The rules the code enforces

- **Nobody is charged unless everyone is in.** A pure state machine (`src/domain/plan/transition.ts`) decides every step.
- **The cap rule.** A charge can never exceed what the person approved. It is checked in four places: the state machine, the hold service, a database constraint, and Stripe itself.
- **Book first, charge last.** Cards are charged only after the suppliers confirm.
- **A price rise of more than 5%** sends everyone back to agree again. A smaller rise only shows a note.
- **Passport details** are encrypted (AES-256-GCM) and deleted as soon as the trip is booked or the plan ends.
- **Overlapping trips are refused.** A group cannot plan dates that clash with a trip it has booked.

## How Muse Spark is used

Muse Spark is the agent's brain, not a text generator bolted on.

- **A reasoning loop with native tool calling** (`src/domain/agent/loop/conversation.ts`). The model takes up to 8 turns. A turn with no tool call is its reply, and it is the only message the group sees. While the model works, a small bubble in the chat says what it is doing ("Searching flights and hotels…", "Putting the plan together…"). That wording is fixed in code, kept on the run and never posted, so a long search does not fill the chat.
- **Three tools** (`tools.ts`, `propose-plan.ts`, `research.ts`): `search_trip` looks up flights and hotels, `propose_plan` puts a plan in front of the group, and `web_research` looks up trip facts on the web (weather and best months, events, entry rules, safety, areas to stay, local tips). The model chooses between them, or none, from what people say. It can ask one question, brainstorm, research, or search.
- **Web research is Muse's own search, kept on a short leash.** Meta's built-in `web_search` is not offered on the Chat Completions API that the loop uses, so `web_research` makes a separate single-question call to it on the Responses API (`muse-http.ts`, `muse-researcher.ts`). The call is given today's date so it prefers current events. At most 2 research calls run per turn, the answer is cut to a fixed length, and the model is given only the **names** of the sites it came from, never their addresses. Web pages are treated as information, never as instructions. Flight and hotel prices never come from the web, only from `search_trip`, and questions that are not about travel get one sentence and a steer back to the trip. A research call costs about 2 to 3 cents ($2.50 per 1,000 searches plus tokens); set `MUSE_WEB_SEARCH=off` to switch it off.
- **It reasons about who needs what.** `search_trip` takes a `flyers` list, so a friend who is already there gets a room and no flight, and flights are priced only for the people who fly.
- **Structured calls** extract each person's limits from the chat (budget caps, flight windows, own room) and suggest things to do in the free time, which are checked against Google Places opening hours.
- **The model proposes, the code decides.** Picks are validated against the real offers that a search returned, every person's share is computed by code, and a proposal that does not cover everyone is rejected. `grounding.ts` removes any dollar amount in a reply that did not come from a search result or from the chat.
- **System prompt:** `src/domain/agent/loop/prompt.ts`. Model client: `src/infrastructure/muse/`. Default model `muse-spark-1.3` through the Meta Model API.

The loop in one picture:

```
 chat ──► Muse Spark (up to 8 turns, native tool calling)
              │
              ├─ search_trip ────► liteAPI sandbox: real flight and hotel offers
              ├─ web_research ───► Muse web search: facts, never prices
              └─ propose_plan ───► checks every pick against the offers just searched,
                                   computes every share in code, rejects a plan that
                                   leaves someone out
              │
              ▼
   one reply to the group  ◄── amounts it did not get from a search or the chat are removed
```

Setting `MUSE_TRACE=1` in development writes every model call and every agent step to `.muse-trace/trace.jsonl`, so a turn can be read back step by step.

## Sandbox and test mode

| Part | What it really is |
|---|---|
| Flights and hotels | [liteAPI](https://docs.liteapi.travel/) **sandbox**. Prices and availability are test data. Bookings are made with the sandbox account credit. |
| Booking codes | Test codes from the sandbox: the airline's or hotel's code is shown on its own flight or hotel card once the trip is booked, and again in a summary on the confirmation. Plan cards carry a "Sandbox listing" tag. |
| Cards | **Stripe test mode.** Use `4242 4242 4242 4242`, any future expiry, any CVC. Holds are manual-capture PaymentIntents. |
| Currency | USD only. |
| Phuket | The sandbox has no hotels there. Use Bangkok. |

## Try it

You need Node 24 and pnpm 12, and your own accounts for the services below. All of them have free or test tiers.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | A Postgres database. It was built on Supabase (use the session pooler, port 5432, locally). |
| `DATABASE_SSL_CA` | The CA certificate that signed your database's certificate, as PEM (a Supabase project: Database settings, SSL configuration). With it the app checks who it is talking to. Optional for local development, **required in production**: the server refuses to start without it. |
| `MUSE_SPARK_API_KEY` | Meta Model API key for Muse Spark. |
| `LITEAPI_KEY` | liteAPI **sandbox** key. |
| `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** keys. |
| `TRAVELLER_ENCRYPTION_KEY` | A 32-byte base64 key: `openssl rand -base64 32`. |
| `CRON_SECRET` | Any long random string. Protects the scheduled routes. |
| `GOOGLE_PLACES_API_KEY` | Optional. Without it, free-time ideas are skipped. |
| `MUSE_WEB_SEARCH` | Optional. Web research is on unless this is `off`. |

```bash
pnpm install
cp .env.example .env.local      # then fill in the values above
pnpm db:migrate                 # creates the tables
pnpm dev                        # http://localhost:3000
```

`SIMULATE_HOLDS` and `SIMULATE_BOOKING` in `.env.example` are development shortcuts. The server refuses to start with either set in production. Leave them empty to see the real flow.

### A walkthrough with two people

The flow needs more than one person, and one browser can be two people:

1. Open `http://localhost:3000`. With no groups yet it goes straight to the new-group form. Create a group and enter your name.
2. Open the group's info page and copy the invite link.
3. Open that link in a **private window**, or swap `localhost` for `127.0.0.1` in the address bar. Each gets its own identity. Enter a second name.
4. In the chat, write something like: `@trippy we are two friends flying from Singapore to Bangkok, 11 to 13 Dec 2026, about $300 each`. Use dates a few weeks ahead. Planning takes 30 to 40 seconds.
5. Both people tap **Agree** in the panel above the message box, then **Approve**, then fill in the traveller details (made-up values; a passport is asked for only from someone on a flight) and the test card.
6. Watch the progress list: hotel, flight, charge. The chat posts "Booked", and the plan screen shows the booking codes on each flight and hotel and each person's receipt. The back arrow in the chat returns to the Trips list.

To see the rollback, back out as one person before the last hold lands: every hold is released and nobody is charged.

Optionally run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`. The app works without it, because the plan screen confirms holds itself.

### Tests

```bash
pnpm test        # about 1,300 tests
pnpm typecheck
pnpm lint
```

Tests that call real services (Muse, Stripe, liteAPI, the database) are opt-in and skipped by default. Their commands are in the header of each `*.live.test.ts` and `*.db.test.ts` file.

### How well the agent behaves, measured

`src/infrastructure/agent-eval.live.test.ts` runs short group chats through the real agent loop with the real Muse model, against fixed test flights and hotels and in-memory storage, and checks what the agent did rather than how it worded it: a plan that covers everyone, an after-6pm flight honoured, a friend who needs no flight, a question asked when dates are missing, no price quoted that was never looked up, a prompt-extraction attempt and an off-topic request both turned away, past dates refused, one message per call. It costs about ten to twenty cents:

```bash
EVAL_LIVE=1 EVAL_OUT=eval.md EVAL_TRACE=trace.json node --env-file=.env.local node_modules/vitest/vitest.mjs run agent-eval.live
```

The latest run passed 22 of 24 checks. Both misses are one weakness that the evaluation found: a change request that alters no limit the agent has recorded (for example "take the cheapest flight") is treated as "nothing has changed", so no replacement plan is made, and the agent then wrongly tells the group it switched. The report also lists what the agent said in each scenario.

## Where things are

| Path | What it holds |
|---|---|
| `src/domain/agent/` | The Muse agent: loop, prompt, tools, grounding |
| `src/domain/plan/` | The plan state machine, pricing, refresh, view |
| `src/domain/split/` | Per-person cost splitting |
| `src/domain/payments/` | Card holds, charging, retries |
| `src/domain/booking/` | Booking runner, cancel-on-failure, stuck-booking sweeper |
| `src/domain/travellers/` | Encrypted traveller details |
| `src/infrastructure/` | Muse, liteAPI, Stripe, Google Places, Postgres |
| `src/app/` | The mobile web app (Trips home, chat, action sheet, plan screens) and its API routes |
| `src/server/` | What the pages and routes read: chat, trips list, plan views, sessions, the wired-up services |

## Known limits

- Sandbox and test mode only, as described above.
- Everyone pays in USD.
- The Trips list is built from the member cookies a browser holds, so clearing the browser loses the list. A group is then only reachable again through its invite link.
- Chat history is read a page at a time; there is no search yet.
- Anyone in a group can end a plan for everyone, though **I need changes** offers a softer route.
- Two scheduled routes (`/api/cron/expire-overdue`, `/api/cron/retry-effects`) end overdue plans, settle stuck bookings, retry failed charges and delete traveller details kept longer than 72 hours. `vercel.json` schedules them daily on Vercel (the free plan's limit), and they need `CRON_SECRET` set there. Nothing runs them locally.
- Security headers are partial: there is no script policy yet.
