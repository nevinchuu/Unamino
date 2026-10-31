<a id="readme-top"></a>

<!--
*** Layout inspired by Best-README-Template (https://github.com/othneildrew/Best-README-Template).
*** Reference-style links are used for readability: the URLs live at the bottom of the file.
-->

<!-- PROJECT SHIELDS -->
[![Stargazers][stars-shield]][stars-url]
[![Forks][forks-shield]][forks-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT HEADER -->
<br />
<div align="center">
  <h3 align="center">Unamino</h3>

  <p align="center">
    <b>Nobody is charged unless everyone has approved.</b>
    <br />
    A group chat where an AI agent gets friends to a trip plan they can all say yes to, then makes sure nobody pays for a trip that did not happen.
    <br />
    <br />
    <a href="https://unamino.vercel.app"><strong>Try it live »</strong></a>
    &middot;
    <a href="#a-60-second-path-for-judges">60-second path for judges</a>
    &middot;
    <a href="https://github.com/nevinchuu/Unamino/issues">Report Bug</a>
    &middot;
    <a href="https://github.com/nevinchuu/Unamino/issues">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#commitment-not-planning">Commitment, not planning</a></li>
        <li><a href="#the-rules-the-code-enforces">The rules the code enforces</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li><a href="#a-60-second-path-for-judges">A 60-second path for judges</a></li>
    <li><a href="#how-muse-spark-is-used">How Muse Spark is used</a></li>
    <li><a href="#identity-and-recovery">Identity and recovery</a></li>
    <li><a href="#sandbox-and-test-mode">Sandbox and test mode</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li>
      <a href="#tests-and-measured-results">Tests and measured results</a>
      <ul>
        <li><a href="#how-well-the-agent-behaves-measured">How well the agent behaves</a></li>
        <li><a href="#how-well-the-nudges-hold-to-their-rules-measured">How well the nudges hold to their rules</a></li>
      </ul>
    </li>
    <li><a href="#where-things-are">Where things are</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#known-limits">Known limits</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

**Nobody is charged unless everyone has approved.** Friends plan a trip in a group chat with an agent called Trippy, built on Meta's Muse Spark. Trippy's job is not to find the best trip. It is to get the whole group to a plan everyone can say yes to. Each person then approves their own capped amount and puts a card **hold** on it. Only when everyone has approved are the flights and hotel booked, and only then are the holds charged. If anything fails, the bookings are cancelled and every hold is released. Nobody pays for a trip that did not happen.

Built for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

**Try it live: [unamino.vercel.app](https://unamino.vercel.app)** ([a 60-second path for judges](#a-60-second-path-for-judges), no sign-up).

> **Everything here runs on test data.** Flights and hotels come from the liteAPI sandbox, and cards are in Stripe test mode. No real booking is made and no real money moves. See [Sandbox and test mode](#sandbox-and-test-mode).

**What was written during the hackathon.** Everything in this repository was written during the event: the first commit is dated 27 October 2026. Open-source dependencies are listed in `package.json`.

### Commitment, not planning

AI agents can already plan a trip. Group trips still fall apart at the next step: someone fronts the money, someone goes quiet, someone drops out, and nobody knows who owes what. Unamino is the part after the plan: getting every person to commit, safely, and undoing everything cleanly if they do not.

The planner is the way in. The product is the commitment engine behind it:

1. **Agree.** Everyone looks at the same plan and taps **Agree**. It costs nothing and no card is involved. Anyone can tap **I need changes** instead, and Trippy adjusts the plan rather than ending it.
2. **Approve your own amount.** Each person approves *their own* share, which becomes a **cap**: the most they can ever be charged. Everyone pays only for what they take part in, so a friend already at the destination pays for the hotel and not a flight.
3. **Hold.** A card hold reserves the capped amount at the person's bank. It is a hold, not a charge, and Unamino never holds anyone's money.
4. **Everyone has approved.** Only when the last hold lands, so every approval is backed by a card hold, does booking start.
5. **Book, then charge.** The parts of the trip are booked, and only after every booking is confirmed is each person charged their real share (never above their cap, and the rest of the hold is released).
6. **If anything fails,** whether a flight sells out, a price rises past someone's cap or the clock runs out, every booking made so far is cancelled, every hold is released, and the group is told which part failed and why.

### The rules the code enforces

- **Nobody is charged unless everyone has approved.** A pure state machine (`src/domain/plan/transition.ts`) decides every step.
- **The cap rule.** A charge can never exceed what the person approved. It is checked in four places: the state machine (`planCaptures` and the `member_charged` step in `src/domain/plan/transition.ts`), the hold service (`captureHolds` in `src/domain/payments/hold-service.ts`), a database constraint (`plan_members_charge_within_cap`, in `drizzle/0000_dashing_medusa.sql`), and Stripe itself, which refuses to capture more than the hold was authorised for. The fake Stripe used in the tests mirrors that last rule, so the real one is only exercised by the opt-in live tests.
- **Book first, charge last.** Cards are charged only after the suppliers confirm.
- **The rollback is true because of the order things are booked in.** Whatever can be cancelled for free is booked first and the part that cannot is booked last (`src/domain/booking/order.ts`), so a failure always leaves what was already booked undoable. The hotel search asks liteAPI for refundable rates as well as the cheapest ones, and a free-cancel room is always on the shortlist. If two or more parts of a plan cannot be cancelled for free, the plan page says plainly which part a later failed booking would not refund. The rollback is tested against the real liteAPI sandbox: a free-cancel hotel is really booked, a stand-in airline refuses the flight, and the runner must cancel the hotel and release the holds (`src/infrastructure/liteapi/rollback.live.test.ts`).
- **People's limits are firm.** A cabin class, free cancellation, a meal need, their own room, a budget and flight times are not preferences. A plan that breaks any of them is refused and saved nowhere. When no option meets a need, Trippy says so honestly and suggests one alternative, and only that person can relax their own need. A need that cannot be checked from the data, such as halal meals, holds the plan until the person says they will confirm it themselves.
- **A price rise of more than 5%** sends everyone back to agree again. A smaller rise only shows a note.
- **A ticking countdown** shows how long the held prices last and turns red in the last two minutes.
- **When a friend drops out,** the admin removes them, the plan ends, every hold is released, and Trippy makes a new plan for the people left. Everyone agrees again, and each person's amount says what it was on the previous plan.
- **Slow friends can be nudged.** A person who has done their part taps "Remind the others", and Trippy writes a short, friendly word to each person who has not, using their own amount and what they said in the chat. Manual only, held back for a few minutes between nudges, and the code throws away any wording that invents a number, names another person, pressures or runs long.
- **People are told where their money is** before they approve: what a hold is, what their banking app will show, how long it lasts and who has the money, in plain words.
- **Passport details** are encrypted (AES-256-GCM) and deleted as soon as the trip is booked or the plan ends.
- **Overlapping trips are refused.** A group cannot plan dates that clash with a trip it has booked.

### Built With

* [![Next.js][nextjs-shield]][nextjs-url]
* [![React][react-shield]][react-url]
* [![TypeScript][typescript-shield]][typescript-url]
* [![Tailwind CSS][tailwind-shield]][tailwind-url]
* [![Postgres][postgres-shield]][postgres-url]
* [![Stripe][stripe-shield]][stripe-url]
* [![Vitest][vitest-shield]][vitest-url]
* [![Vercel][vercel-shield]][vercel-url]
* Meta's **Muse Spark** through the Meta Model API, **liteAPI** (sandbox) for flights and hotels, and Google Places for free-time ideas

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- A 60-SECOND PATH FOR JUDGES -->
## A 60-second path for judges

You do not need other people: simulated friends can fill the group. A group of one can try the whole flow too.

1. Open [unamino.vercel.app](https://unamino.vercel.app) and tap **Try the demo with test friends**. It makes a group called "Bangkok demo" with three simulated friends (Maya has a tight budget, Leo wants his own room, Priya is easygoing) and asks Trippy for a Bangkok hotel plan in your name. The friends chat in character, agree, approve and place a Stripe test hold on their own. They are for the hotel only and never fly. The plan is ready in about a minute, while you read the chat.
2. Prefer to set it up yourself? Tap **+**, make a group, tap the flask in the chat header to add test friends, and write: `@trippy plan a Bangkok hotel stay for the 3 of us, hotel only, we are all already there, 11 to 13 Dec 2026, about $200 each`.
3. Look at the plan Trippy put up. It already respects Maya's budget and Leo's room, because the code refuses a plan that breaks anyone's limits.
4. Tap **Agree**, then **Approve**, give made-up traveller details, and use the test card `4242 4242 4242 4242` with any future expiry and any CVC.
5. Watch the progress list: hotel, charge. The plan then says **Trip confirmed**.
6. **To see what happens when booking fails,** tap **Try the demo where booking fails** on the new-group page instead of the first button. It is the same group and plan, but once the hotel is really booked in the sandbox, a final fare check fails on purpose, and the screen says so (it is labelled a demo). The hotel is cancelled with the supplier, every hold is released and the plan says nothing was charged. Tapping **Back out** before the last hold lands is a different thing: it is a person ending the plan, which also releases every hold.
7. Try the commitment features: tap **I need changes** and watch Trippy adjust the plan, tap **Cover a friend's share** to pay some or all of someone else's amount (the plan goes back to step 1 so everyone sees the new split, and a friend covered in full has nothing to hold), or remove a test friend in Group info (the menu next to their name) and watch Trippy make a new plan for the people left.

Simulated friends exist only for judging and can be switched off with `PERSONAS=off`. Each demo tap makes about twenty paid model calls, so the demo buttons are limited to 5 an hour and 15 a day per person (and 10 an hour and 40 a day for the whole site). If you reach the limit, your earlier demo groups are in the **Trips** list.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- HOW MUSE SPARK IS USED -->
## How Muse Spark is used

Muse Spark is the agent's brain, not a text generator bolted on. It does two jobs, and in both the rule is the same: **the model proposes, the code decides.**

### Getting a group to yes

- **It reads each person's limits from the chat** (budget caps, flight windows, a room of their own, free cancellation, a cabin class, a meal need) with structured calls. Those limits then become rules the code enforces. A plan that breaks one is refused, whatever the model wrote.
- **It turns an objection into a change.** "I need changes" or a worry in the chat becomes a replacement plan, not an ended one.
- **It writes the nudges** to people who have not yet agreed or approved, in two short sentences that start with the person's name.
- **It re-plans when someone drops out,** and keeps the group's agreement honest by sending everyone back to agree on the new split.
- **Money and rules never come from the model.** Every share is computed by code, an amount in a reply that did not come from a search or the chat is removed (`grounding.ts`), and the model never shows an internal id.

### Finding the trip

- **A reasoning loop with native tool calling** (`src/domain/agent/loop/conversation.ts`). The model takes up to 8 turns. A turn with no tool call is its reply, and it is the only message the group sees. While the model works, a small bubble in the chat says what it is doing ("Searching flights and hotels…", "Putting the plan together…"). That wording is fixed in code, kept on the run and never posted.
- **Three tools** (`tools.ts`, `propose-plan.ts`, `research.ts`): `search_trip` looks up flights and hotels, `propose_plan` puts a plan in front of the group, and `web_research` looks up trip facts on the web (weather and best months, events, entry rules, safety, areas to stay, local tips). The model chooses between them, or none, from what people say. It can ask one question, brainstorm, research, or search.
- **Web research is Muse's own search, kept on a short leash.** Meta's built-in `web_search` is not offered on the Chat Completions API that the loop uses, so `web_research` makes a separate single-question call to it on the Responses API (`muse-http.ts`, `muse-researcher.ts`). At most 2 research calls run per turn, the answer is cut to a fixed length, and the model is given only the **names** of the sites it came from, never their addresses. Web pages are treated as information, never as instructions. Flight and hotel prices never come from the web, only from `search_trip`. A research call costs about 2 to 3 cents; set `MUSE_WEB_SEARCH=off` to switch it off.
- **It reasons about who needs what.** `search_trip` takes a `flyers` list, so a friend who is already there gets a room and no flight, and flights are priced only for the people who fly.
- **Free-time ideas** are suggested and checked against Google Places opening hours.
- **Picks are validated** against the real offers that a search returned, and a proposal that does not cover everyone is rejected.
- **System prompt:** `src/domain/agent/loop/prompt.ts`. Model client: `src/infrastructure/muse/`. Default model `muse-spark-1.3` through the Meta Model API.

The loop in one picture:

```
 chat ──► Muse Spark (up to 8 turns, native tool calling)
              │
              ├─ search_trip ────► liteAPI sandbox: real flight and hotel offers
              ├─ web_research ───► Muse web search: facts, never prices
              └─ propose_plan ───► checks every pick against the offers just searched,
                                   refuses a plan that breaks anyone's limits,
                                   computes every share in code
              │
              ▼
   one reply to the group  ◄── amounts it did not get from a search or the chat are removed
              │
              ▼
   agree ► approve your cap ► hold ► everyone has approved ► book (free-cancel first) ► charge
                                         │
                                         └─ any failure: cancel what was booked, release every hold
```

Setting `MUSE_TRACE=1` in development writes every model call and every agent step to `.muse-trace/trace.jsonl`, so a turn can be read back step by step.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- IDENTITY AND RECOVERY -->
## Identity and recovery

There are no accounts. Being "you" in a group means your browser holds a secret (a long random token in a cookie, kept on the server only as a hash). That keeps the demo to one tap, with no sign-up, no password and no contact details to look after. The cost is that the secret *is* the identity, so getting back in after losing it has to be designed on purpose.

**What is built**

- **An access link.** Group info has *Your access link*: it makes a new secret for you and shows it once as a link. Opening it on another phone asks "Continue as ...?", and only the button signs in, so a link preview or a prefetch cannot. Making a new link signs out your other devices and replaces the old link.
- **Admin re-issue.** If someone lost their phone and never saved a link, the group admin can make a new one for them (the menu next to their name). It signs out their old devices, the chat shows "Maya reset Ana's access link.", and the admin sends the link themselves.
- **A reminder.** A slim bar in the chat asks each person, once, to save their link.
- **Leaving and removal.** Anyone can exit, the admin can remove someone and replace the invite link, and a booked trip cannot be left or deleted.

**What someone holding a link can and cannot do.** Anyone with a link can act as that person until it is replaced, which is why the chat says when one is reset. They can read the chat, post, agree and approve as that person, ask Trippy, and see confirmations and receipts. They cannot see or use a card (the form is Stripe's and a card is never stored), read traveller or passport details (encrypted, never shown in the app, deleted once the trip is booked), or move money to themselves, because every charge still needs that person's own card hold. Names and chat are personal data, so they are kept only as long as the retention rules in the privacy notice say.

**What a real launch would add.** Single-use recovery links that expire, with a "signed back in" line in the chat; verified contact details (an email or phone code) or real accounts; a shorter cookie life with a sign-out button; and a second admin so the group is never left without one. None of that is built here, on purpose: it costs more than it earns in a demo that uses test data and test cards.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SANDBOX AND TEST MODE -->
## Sandbox and test mode

| Part | What it really is |
|---|---|
| Flights and hotels | [liteAPI](https://docs.liteapi.travel/) **sandbox**. Prices and availability are test data. Bookings are made with the sandbox account credit. |
| Booking codes | Test codes from the sandbox: the airline's or hotel's code is shown on its own flight or hotel card once the trip is booked, and again in a summary on the confirmation. Plan cards carry a "Sandbox listing" tag. |
| Cards | **Stripe test mode.** Use `4242 4242 4242 4242`, any future expiry, any CVC. Holds are manual-capture PaymentIntents. |
| Currency | USD only. |
| Phuket | The sandbox has no hotels there. Use Bangkok. |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

This is how to run Unamino on your own machine. All of the services below have free or test tiers.

### Prerequisites

* Node 24 and pnpm 12
  ```sh
  npm install -g pnpm@12
  ```
* Your own accounts for the services in the table under Installation: a Postgres database (it was built on Supabase), a Meta Model API key for Muse Spark, a liteAPI **sandbox** key and Stripe **test** keys

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/nevinchuu/Unamino.git
   cd Unamino
   ```
2. Install the packages
   ```sh
   pnpm install
   ```
3. Copy the example settings and fill in the values from the table below
   ```sh
   cp .env.example .env.local
   ```
4. Create the tables
   ```sh
   pnpm db:migrate
   ```
5. Start the app on `http://localhost:3000`
   ```sh
   pnpm dev
   ```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | A Postgres database. It was built on Supabase (use the session pooler, port 5432, locally). |
| `DATABASE_SSL_CA` | The CA certificate that signed your database's certificate, as PEM (a Supabase project: Database settings, SSL configuration). With it the app checks who it is talking to. Optional for local development, **required in production**: the server refuses to start without it. |
| `MUSE_SPARK_API_KEY` | Meta Model API key for Muse Spark. |
| `LITEAPI_KEY` | liteAPI **sandbox** key. |
| `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** keys. |
| `TRAVELLER_ENCRYPTION_KEY` | A 32-byte base64 key: `openssl rand -base64 32`, or without OpenSSL (for example on Windows) `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `CRON_SECRET` | Any long random string. Protects the scheduled routes and keys the per-person group limit. |
| `GOOGLE_PLACES_API_KEY` | Optional. Without it, free-time ideas are skipped. |
| `MUSE_WEB_SEARCH` | Optional. Web research is on unless this is `off`. |
| `PERSONAS` | Optional. Simulated test friends are on unless this is `off`. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional. An address shown in the money explanation for a charge that looks wrong. |

`SIMULATE_HOLDS` and `SIMULATE_BOOKING` in `.env.example` are development shortcuts. The server refuses to start with either set in production. Leave them empty to see the real flow.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->
## Usage

### A walkthrough with two real people

The flow also works with more than one real person, and one browser can be two people:

1. Open `http://localhost:3000`. With no groups yet it goes straight to the new-group form. Create a group and enter your name.
2. Open the group's info page and copy the invite link.
3. Open that link in a **private window**, or swap `localhost` for `127.0.0.1` in the address bar. Each gets its own identity. Enter a second name.
4. In the chat, write something like: `@trippy we are two friends flying from Singapore to Bangkok, 11 to 13 Dec 2026, about $300 each`. Use dates a few weeks ahead.
5. Both people tap **Agree**, then **Approve**, then fill in the traveller details (made-up values; a passport is asked for only from someone on a flight) and the test card.
6. Watch the progress list: hotel, flight, charge. The chat posts "Booked", and the plan screen shows the booking codes on each flight and hotel and each person's receipt.

Optionally run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`. The app works without it, because the plan screen confirms holds itself.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- TESTS AND MEASURED RESULTS -->
## Tests and measured results

```sh
pnpm install --frozen-lockfile
pnpm test        # about 1,800 tests run by default; the opt-in ones are skipped
pnpm typecheck   # also generates the route types a fresh clone needs
pnpm lint
```

Tests that call real services (Muse, Stripe, liteAPI, the database) are opt-in and skipped by default. `pnpm test` needs no keys. The two measured results below (the agent check and the nudge check) were produced with the author's own Muse, Stripe and liteAPI sandbox keys, so reproducing them needs your own. Their commands are in the header of each `*.live.test.ts` and `*.db.test.ts` file. The rollback check, which books and cancels a real sandbox hotel, is `rollback.live.test.ts`.

### How well the agent behaves, measured

`src/infrastructure/agent-eval.live.test.ts` runs short group chats through the real agent loop with the real Muse model, against fixed test flights and hotels and in-memory storage, and checks what the agent did rather than how it worded it: a plan that covers everyone, an after-6pm flight honoured, a friend who needs no flight, a question asked when dates are missing, no price quoted that was never looked up, a prompt-extraction attempt and an off-topic request both turned away, past dates refused, one message per call. It costs about ten to twenty cents:

```sh
EVAL_LIVE=1 EVAL_OUT=eval.md EVAL_TRACE=trace.json node --env-file=.env.local node_modules/vitest/vitest.mjs run agent-eval.live
```

The latest two runs (31 October 2026, after the system prompt's wording changed from "everyone is in" to "everyone has approved") each passed 23 of 24 checks across 8 scenarios, with 16 model calls each. The same one check missed both times: when a change request could only be met by a cheaper flight that breaks someone's recorded limit (an after-6pm flight), the agent kept the old plan up and asked that person whether to drop the limit, instead of putting up a replacement plan. That is arguably the right thing to do, but the check counts it as a miss, and it is reported as measured. The history of this one check: an earlier run passed 22 of 24 (this weakness, a change request that altered no limit the agent had recorded being treated as "nothing has changed"), a fix brought it to 24 of 24, and one run with the old wording put back also passed 24 of 24, so the wording may matter or the model may simply vary from run to run. Eight scenarios is a small sample on one model, so read it as a regression guard, not a benchmark.

### How well the nudges hold to their rules, measured

The nudges are the part of Muse Spark that gets a slow friend to agree or approve, so they are checked separately. `src/domain/nudge/nudge.live.test.ts` asks the real model to word 20 varied nudges (both steps, with and without a share or a deadline, a worry or a budget voiced in the chat, a hotel that is not free to cancel, and chat that tries to steer the nudge: a made-up share, a request to name everyone, a request to pressure). Each is then run through the same code rules that guard it in the app: it starts with the person's name, is at most two sentences, uses only amounts and minutes it was given, names nobody else and applies no pressure. In the latest run (after the same wording change) all 20 of 20 passed on the first try, averaging 132 characters (longest 237), so none needed the plain-wording fallback. That fallback is still there for the day the model does break a rule, and the rules are enforced in code whatever the model writes. It costs a few cents:

```sh
MUSE_LIVE=1 MUSE_LIVE_OUT=nudges.txt node --env-file=.env.local node_modules/vitest/vitest.mjs run nudge.live
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- WHERE THINGS ARE -->
## Where things are

| Path | What it holds |
|---|---|
| `src/domain/plan/` | The plan state machine, pricing, refresh, view |
| `src/domain/booking/` | Booking runner and its order, cancel-on-failure, stuck-booking sweeper |
| `src/domain/split/` | Per-person cost splitting |
| `src/domain/payments/` | Card holds, charging, retries |
| `src/domain/constraints/` | People's limits and the check that refuses a plan that breaks them |
| `src/domain/nudge/` | The wording and rules for nudges |
| `src/domain/persona/` | The simulated test friends |
| `src/domain/agent/` | The Muse agent: loop, prompt, tools, grounding |
| `src/domain/travellers/` | Encrypted traveller details |
| `src/infrastructure/` | Muse, liteAPI, Stripe, Google Places, Postgres |
| `src/app/` | The mobile web app (Trips home, chat, action sheet, plan screens) and its API routes |
| `src/server/` | What the pages and routes read: chat, trips list, plan views, sessions, the wired-up services |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] A group chat with an AI agent that gets the group to a plan everyone can agree to
- [x] Two-step approval: agree for free, then approve a capped amount backed by a card hold
- [x] Book first, charge last, with a rollback that cancels bookings and releases every hold
- [x] A demo where booking fails on purpose, to see the rollback
- [x] A check of every hold before charging, and a clear screen when only some cards have been charged
- [x] Simulated friends and a one-tap demo, so one person can try the whole flow
- [ ] Real accounts or verified contact details, and single-use recovery links (see [Identity and recovery](#identity-and-recovery))
- [ ] A refund and dispute path after a charge
- [ ] Notifications outside the app
- [ ] Chat search
- [ ] Currencies other than USD
- [ ] A script policy for the security headers
- [ ] Checking liteAPI's behaviour for real, non-sandbox bookings

See [Known limits](#known-limits) and the [open issues](https://github.com/nevinchuu/Unamino/issues) for more.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- KNOWN LIMITS -->
## Known limits

- Sandbox and test mode only, as described above. How liteAPI behaves for real flights, payments and cancellation charges has not been verified.
- Everyone pays in USD.
- A hold lasts as long as the card's bank allows, typically up to about 7 days. The app books as soon as everyone has approved and cancels the holds if the plan ends first, but it cannot control when a bank frees the money.
- **Booking happens before the charges, and card charges cannot be made as one transaction.** Before charging anyone the app checks that every hold is still good, and each person's charge is written down as it lands. If a charge still fails (the payment service is down, say), the trip stays booked, the plan screen shows who has been charged and who is still to be, and the failed charges are tried again when someone opens the plan and by the daily retry, up to five tries. After that the group is told that the organiser needs to sort it out. Nobody is ever charged more than they approved, and a charge is never made twice, but in that case some people can be charged while others are not yet.
- There is no refund or dispute path in the app after a charge.
- The comparison "Was $X on the previous plan" finds the earlier plan from the same group and dates, so it can occasionally compare with the wrong one.
- Nudges are manual: Trippy never messages anyone on its own, and there are no notifications outside the app.
- The Trips list is built from the member cookies a browser holds, so clearing the browser loses the list. A group is then reachable again through an access link, if the person saved one, or one the group admin makes for them (see *Identity and recovery*). A person who never saved one, and whose group has no other admin, cannot be recovered.
- Chat history is read a page at a time; there is no search yet.
- Anyone in a group can end a plan for everyone, though **I need changes** offers a softer route.
- Two scheduled routes (`/api/cron/expire-overdue`, `/api/cron/retry-effects`) end overdue plans, settle stuck bookings, retry failed charges and delete traveller details kept longer than 72 hours. `vercel.json` schedules them daily on Vercel (the free plan's limit), and they need `CRON_SECRET` set there. Nothing runs them locally.
- Security headers are partial: there is no script policy yet.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Unamino is a hackathon project, so it is a snapshot and may change slowly. Feedback is welcome: open an issue with the `enhancement` or `bug` label. If you would like to try a change yourself:

1. Fork the project
2. Create your feature branch (`git checkout -b feature/short-name`)
3. Commit your changes with a short message (`git commit -m 'Add a short phrase'`)
4. Push to the branch (`git push origin feature/short-name`)
5. Open a pull request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

nevinchuu - [github.com/nevinchuu](https://github.com/nevinchuu)

Project Link: [https://github.com/nevinchuu/Unamino](https://github.com/nevinchuu/Unamino)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) and its organisers, for the event this was built for
* [Meta Muse Spark](https://www.meta.ai/), the model behind Trippy
* [liteAPI](https://docs.liteapi.travel/), for the flight and hotel sandbox
* [Stripe](https://stripe.com/docs/testing), for test mode and manual-capture holds
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), for the layout of this README
* [Shields.io](https://shields.io), for the badges

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[stars-shield]: https://img.shields.io/github/stars/nevinchuu/Unamino.svg?style=for-the-badge
[stars-url]: https://github.com/nevinchuu/Unamino/stargazers
[forks-shield]: https://img.shields.io/github/forks/nevinchuu/Unamino.svg?style=for-the-badge
[forks-url]: https://github.com/nevinchuu/Unamino/network/members
[issues-shield]: https://img.shields.io/github/issues/nevinchuu/Unamino.svg?style=for-the-badge
[issues-url]: https://github.com/nevinchuu/Unamino/issues
[license-shield]: https://img.shields.io/github/license/nevinchuu/Unamino.svg?style=for-the-badge
[license-url]: https://github.com/nevinchuu/Unamino/blob/main/LICENSE
[nextjs-shield]: https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[nextjs-url]: https://nextjs.org/
[react-shield]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://react.dev/
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com/
[postgres-shield]: https://img.shields.io/badge/Postgres-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[postgres-url]: https://www.postgresql.org/
[stripe-shield]: https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white
[stripe-url]: https://stripe.com/
[vitest-shield]: https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[vitest-url]: https://vitest.dev/
[vercel-shield]: https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white
[vercel-url]: https://vercel.com/
