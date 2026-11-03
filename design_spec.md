# Leeterboard — Architecture Design Spec

A reference for the architecture styles that could shape this bot, what each one
looks like when applied here, and which ones are worth adopting.

---

## 1. Where the code is today

Everything that handles an interaction lives in `src/app.js`: routing, game rules,
Discord message building, and calls into LeetCode and SQLite.

```
┌──────────────────────────── src/app.js ────────────────────────────┐
│                                                                    │
│  Express route ─► if/else on interaction type                      │
│                     ├─ /leaderboard ─► get_players ─► get_live_stats│
│                     ├─ /random      ─► get_random_problem          │
│                     ├─ join button  ─► "already joined?" rule      │
│                     ├─ modal submit ─► save_user / add_player      │
│                     └─ refresh      ─► get_players ─► ...          │
│                                                                    │
│  list_scores()          ◄── points formula + pass/fail live here   │
│  render_leaderboard()   ◄── Discord JSON                           │
│  render_random_question()                                          │
└────────────────────────────────────────────────────────────────────┘
          │                                   │
          ▼                                   ▼
   src/leetcode.js (GraphQL)            src/db.js (SQLite)
```

**Main issue:** game rules (scoring, pass/fail, join-once) are mixed into the
Discord layer, so they can't be tested without building Discord responses.

---

## 2. Hexagonal (Ports & Adapters)

The core holds the rules. Everything outside talks to it through ports, and
adapters implement those ports for a specific technology.

```
          DRIVING SIDE                                 DRIVEN SIDE
     (calls into the app)                         (the app calls out)

 ┌──────────────────────┐                       ┌──────────────────────┐
 │ Discord interactions │                       │  LeetCode GraphQL    │
 │ (slash, buttons,     │──┐                ┌──►│  adapter             │
 │  modals)             │  │                │   └──────────────────────┘
 └──────────────────────┘  │  ┌──────────┐  │   ┌──────────────────────┐
                           ├─►│   CORE   │──┼──►│  SQLite adapter      │
 ┌──────────────────────┐  │  │  points  │  │   └──────────────────────┘
 │ Scheduler / cron     │──┘  │  weeks   │  │   ┌──────────────────────┐
 │ (end of week)        │     │  joins   │  └──►│  Discord REST        │
 └──────────────────────┘     └──────────┘      │  (unprompted posts)  │
                           ▲                ▲   └──────────────────────┘
                     driving ports     driven ports
                 (use cases the core   (what the core needs:
                  offers)               get counts, save players)
```

---

## 3. Onion Architecture

Same idea as hexagonal, drawn as rings. Dependencies point inward only.

```
 ┌─────────────────────────────────────────────────────────┐
 │  Infrastructure / UI                                    │
 │  Express, Discord JSON, better-sqlite3, fetch           │
 │   ┌─────────────────────────────────────────────────┐   │
 │   │  Application services                           │   │
 │   │  JoinGame, GetLeaderboard, EndWeek              │   │
 │   │   ┌─────────────────────────────────────────┐   │   │
 │   │   │  Domain services                        │   │   │
 │   │   │  scoring, week rollover                 │   │   │
 │   │   │   ┌─────────────────────────────────┐   │   │   │
 │   │   │   │  Domain model                   │   │   │   │
 │   │   │   │  Game, Player, SolveCounts      │   │   │   │
 │   │   │   └─────────────────────────────────┘   │   │   │
 │   │   └─────────────────────────────────────────┘   │   │
 │   └─────────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────────┘
              outer rings depend on inner rings, never the reverse
```

---

## 4. Clean Architecture

A close relative of hexagonal and onion. Its distinctive layer is **use cases**:
one unit per thing a user can do. Discord handlers become thin controllers.

```
  Discord interaction
         │
         ▼
 ┌────────────────┐    ┌────────────────────┐    ┌──────────────┐
 │  Controller    │───►│     Use case       │───►│   Entities   │
 │  (handler)     │    │  JoinGame          │    │  Game        │
 │  parse input   │    │  GetLeaderboard    │    │  Player      │
 └────────────────┘    │  RollRandomProblem │    │  SolveCounts │
         ▲             │  EndWeek           │    └──────────────┘
         │             └─────────┬──────────┘
 ┌────────────────┐              │ calls through interfaces
 │  Presenter     │◄─── result ──┤
 │  render_* →    │              ▼
 │  Discord JSON  │    ┌────────────────────┐
 └────────────────┘    │  Gateways          │
                       │  LeetCodeGateway   │
                       │  PlayerRepository  │
                       └────────────────────┘
```

---

## 5. Vertical Slice Architecture

Organize by **feature** instead of by layer. Each slice owns its handler,
logic, view and queries. A new command touches one folder.

```
 Layered (horizontal)                 Vertical slices
 ────────────────────                 ───────────────

 handlers/  ┌───┬───┬───┐         ┌─────────┐ ┌─────────┐ ┌─────────┐
            │ L │ R │ J │         │ leader- │ │ random/ │ │ join/   │
 logic/     ├───┼───┼───┤         │ board/  │ │         │ │         │
            │ L │ R │ J │   ──►   │ handler │ │ handler │ │ handler │
 views/     ├───┼───┼───┤         │ logic   │ │ logic   │ │ logic   │
            │ L │ R │ J │         │ view    │ │ view    │ │ view    │
 db/        ├───┼───┼───┤         │ queries │ │         │ │ queries │
            │ L │ R │ J │         └─────────┘ └─────────┘ └─────────┘
            └───┴───┴───┘              shared: core/, adapters/

 L = leaderboard, R = random, J = join
```

---

## 6. Domain-Driven Design (tactical patterns)

Model the game with names from the domain itself.

```
 ┌─────────────────────── Game (aggregate root) ───────────────────────┐
 │  channel_id, week_start, threshold                                  │
 │                                                                     │
 │  join(player)        ── enforces "can't join twice"                 │
 │  end_week(live)      ── records results, resets baselines           │
 │                                                                     │
 │   ┌──────────── Player (entity) ────────────┐                       │
 │   │  discord_id, leetcode                   │                       │
 │   │  baseline: SolveCounts ─────────────────┼──┐                    │
 │   └─────────────────────────────────────────┘  │                    │
 └────────────────────────────────────────────────┼────────────────────┘
                                                  ▼
                          ┌──── SolveCounts (value object) ────┐
                          │  easy, medium, hard (immutable)    │
                          │  points() = e + 3m + 6h            │
                          │  minus(other) → gained this week   │
                          └────────────────────────────────────┘

        GameRepository ── loads/saves the whole aggregate (SQLite behind it)
```

---

## 7. CQRS (Command Query Responsibility Segregation)

Separate the code paths that **change** state from the ones that **read** it.

```
                    ┌──────────── WRITE SIDE (commands) ────────────┐
  join button  ───► │  JoinGame ──► Game aggregate ──► SQLite       │
  end of week  ───► │  EndWeek  ──► Game aggregate ──► SQLite       │
                    └───────────────────────────────────────────────┘

                    ┌──────────── READ SIDE (queries) ──────────────┐
  /leaderboard ───► │  LeaderboardQuery ──► SQL + live stats ──► view│
  refresh      ───► │  (no rules enforced, just shaped for display) │
  /random      ───► │  RandomProblemQuery ──► LeetCode ──► view     │
                    └───────────────────────────────────────────────┘
```

---

## 8. Event-Driven (Domain Events)

The core announces what happened; listeners react without the core knowing
about them.

```
                                   ┌──► post recap message to channel
                                   │
  EndWeek ──► emits  WeekEnded ────┼──► update player streaks
                                   │
                                   └──► write weekly_results rows

                                   ┌──► refresh the leaderboard message
  JoinGame ─► emits PlayerJoined ──┤
                                   └──► send "welcome" ephemeral
```

Adding a new reaction means adding a listener, not editing `end_week`.

---

## 9. Background Jobs (Queue + Worker)

Discord requires a response within **3 seconds**. Slow work (fetching every
player from LeetCode) moves to a worker.

```
 Discord ──► /leaderboard
               │
               ├──► respond immediately: DEFERRED ("bot is thinking…")   < 3s
               │
               └──► enqueue job ──► ┌────────────┐
                                    │   Worker   │──► LeetCode × N players
                                    └─────┬──────┘
                                          │
                                          ▼
                         PATCH original message with the leaderboard
```

An in-process queue shows the idea; BullMQ/Redis or SQS is the production version.

---

## 10. Event Sourcing (for reference)

Store every change as an event; current state is derived by replaying them.

```
 events: ┌──────────┬────────────┬──────────┬────────────┬──────────┐
         │ Joined   │ Solved(M)  │ Solved(E)│ WeekEnded  │ Solved(H)│ ...
         └──────────┴────────────┴──────────┴────────────┴──────────┘
                                │ replay / project
                                ▼
                       leaderboard, streaks, history
```

---

## 11. Summary

| Pattern | Core idea | Fit for this bot |
|---|---|---|
| Hexagonal | Core + ports + adapters | ✅ Natural fit; Discord, LeetCode, SQLite are clear adapters |
| Onion | Dependency rings pointing inward | ✅ Same benefits as hexagonal |
| Clean Architecture | Use cases as first-class units | ✅ Best-known, maps cleanly to commands |
| Vertical Slice | Organize by feature | ✅ Bots are naturally feature-shaped |
| DDD (tactical) | Aggregates, entities, value objects | 🟡 Light version (`Game`, `SolveCounts`) |
| CQRS | Separate reads from writes | 🟡 Separate code paths only, not separate stores |
| Event-driven | Domain events + listeners | ✅ Great for week-end recap, streaks |
| Background jobs | Ack fast, work async | 🟡 Solves the 3-second rule |
| Event sourcing | State = replayed events | ❌ Overkill at this scale |
| Microservices | Separately deployed services | ❌ Avoid |

---

## 12. Recommended target

Vertical slices on top of a clean core, with domain events for the weekly cycle.

```
src/
  core/                    ← no imports from discord, express, sqlite, fetch
    scoring.js               points(), passed()
    game.js                  join rules, week rollover
    events.js                WeekEnded, PlayerJoined
  features/
    leaderboard/             handler.js · view.js · query.js
    random/                  handler.js · view.js
    join/                    handler.js · modal.js · use_case.js
    end_week/                use_case.js · listeners/
  adapters/
    leetcode.js              LeetCode GraphQL
    db.js                    SQLite repository
    discord/                 router.js · ui helpers · responses
  app.js                   ← composition root: wire adapters into features
test/
  core/                    ← unit tests, plain objects, no network
docs/
  adr/                     ← why each decision was made
```

**Supporting practices**
- Unit tests on `core/` and a GitHub Actions workflow that runs them
- Architecture Decision Records in `docs/adr/` (including why *not* microservices or event sourcing)
- Database migrations instead of `CREATE TABLE IF NOT EXISTS`
- Structured logging (stdout for info, stderr for errors)
- Config via environment variables (Twelve-Factor)

---

## 13. Leaderboard redesign

Bring the leaderboard up to the style of the `/random` card: an accent bar that
means something, a short header, small `-#` metadata text, and emoji buttons.
This is purely view-layer work (`render_leaderboard` / the leaderboard presenter).

### Main state

`┃` is the container's accent bar. Lines starting with `-#` render as small gray subtext.

```
┃ ## 🏆 Leaderboard
┃ -# Week started 3 days ago · goal 10 pts · 2/5 on track
┃ ───────────────────────────────────────────
┃ 🥇 **austin** · 14 pts ✅
┃ -# ▰▰▰▰▰▰▰▰▰▰  +2E · +2M · +1H
┃
┃ 🥈 **bob** · 10 pts ✅
┃ -# ▰▰▰▰▰▰▰▰▰▰  +1E · +3M
┃
┃ 🥉 **carl** · 7 pts
┃ -# ▰▰▰▰▰▰▰▱▱▱  7/10 · +1E · +2M
┃
┃ 4. **dana** · 3 pts
┃ -# ▰▰▰▱▱▱▱▱▱▱  3/10 · +1M
┃
┃ 5. **eli** · 0 pts
┃ -# ▱▱▱▱▱▱▱▱▱▱  nothing yet 👀
┃ ───────────────────────────────────────────
┃ -# refreshed just now
┃ [ 🙋 Join ]  [ 🔄 Refresh ]
```

### Other states

Everyone passed: green bar, celebratory subheader.
```
┃ ## 🏆 Leaderboard
┃ -# Week started 5 days ago · goal 10 pts · everyone's on track 🎉
```

Nobody has scored: red bar.
```
┃ ## 🏆 Leaderboard
┃ -# Week started 2 days ago · goal 10 pts · 0/4 on track 😬
```

No players yet: gray bar and a call to action.
```
┃ ## 🏆 Leaderboard
┃ -# No one's in yet. Be the first 👇
┃ [ 🙋 Join ]
```

### Rules

| Element | Behavior |
|---|---|
| Rank | 🥇 🥈 🥉 for the top 3, then `4.`, `5.`, … |
| Name line | `**name** · N pts`, with ✅ once at or above the goal (no ❌) |
| Progress bar | 10 segments, filled in proportion to `points / threshold`, capped at full |
| Breakdown | Gained this week per difficulty (`+2E · +1M`); zero counts omitted |
| Progress text | `N/goal` shown only while below the goal; `nothing yet 👀` at 0 |
| Accent color | Green if everyone passed, LeetCode orange `0xffa116` if some, red if none, gray if no players |
| Subheader | `<t:week_start:R>` relative timestamp, goal from `games.threshold`, `X/Y on track` |
| Footer | `<t:now:R>` so viewers see when Refresh last ran |
| Buttons | `🙋 Join` (primary), `🔄 Refresh` (secondary), using `ButtonStyleTypes` constants |
| Failed lookup | Player whose LeetCode stats couldn't be fetched shows 0 pts (no crash) |

Discord renders `<t:…:R>` timestamps live in each viewer's timezone, so
"3 days ago" and "just now" update without a refresh.
