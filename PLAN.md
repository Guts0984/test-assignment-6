# PLAN — Room booking calendar

Source of truth: `test-assignment-6.md` (kept in ~/Downloads). Assignment is priority #1: where it says something, do exactly that.
Working rules (from the user): no git commits by me; functional style, no classes; tests must find real bugs (mutation-check important ones);
never regress; keep going without waiting for review; decide ambiguities myself and record them in README.

## STATUS / REMAINING WORK (assignment-driven; tick as done)

Backend done: schema+exclusion constraint, seed, auth, events API (versions, 409s, series scopes), docker, CI(docker job).

- [x] R1 Realtime backend: SSE stream (+ Last-Event-ID replay, origin id for echo suppression) and `GET /api/users` (participants)
- [x] R2 Frontend foundation: deps, providers (Query, intl by PROFILE locale), login page, API client, theme; bundle-size spike (200KB gz!)
- [x] R3 Calendar domain logic, pure + unit tests: grid math (15 min snap), overlap layout, ranges/week start by locale, month cells "+N", locale time format/parse, multi-day/all-day segmentation in user tz
- [x] R4 Views with SSR in user tz: week, day (<=50 room columns, sticky time), month, list (infinite); URL state (view/date/rooms), back/forward; 2nd tz column; now-line
- [x] R5 Interactions: drag-create, move (days+rooms), resize; mouse+touch+keyboard; screen-reader announcements; no full-grid re-render
- [x] R6 Mutations: optimistic + rollback w/ clear message (who blocks), undo/redo (20, server-synced), rapid actions don't desync
- [x] R7 Offline: IndexedDB queue (survives reload, ordered replay), conflict screen (mine vs server, diff, lazy), status indicator
- [x] R8 SSE client: others' changes appear live, own echo no flicker
- [x] R9 Form side panel (RHF+Zod), recurrence editor (lazy), free-room suggestions (debounce, stale-guard), unsaved-changes guard, focus mgmt
- [x] R10 Storybook + MSW (shared handlers) + interaction tests (drag, form)
- [x] R11 Playwright e2e (listed in §9) x3 runs, screenshots 3 browsers light/dark, axe on all views
- [x] R12 Performance (178 KB gz first load; e2e/perf.spec.ts INP + frames; Lighthouse CI via scripts/lighthouse.mjs): budgets, measurements, Lighthouse CI (perf>=90, a11y=100)
- [x] R13 CI complete (lint, types, unit, storybook build+tests, e2e, screenshots, lhci), README (§10)

### Decisions forced by measurement (record in README)

- Measured gz JS: trivial Next16+React19+next-intl page = 145 KB (modern browser, excluding the noModule polyfill). Temporal polyfill = 47 KB, zod = 92 KB, react-query 14, react-hook-form 16, use-intl 15, rrule 14, zustand 4, zod/mini 4. Budget is 200 KB => Temporal/zod/rrule can NOT be in the first load.
- Client + shared calendar logic use `src/shared/zoned` (tiny Intl-based zone engine, numbers/strings only, no `Date`), differentially tested against Temporal (the oracle) incl. DST gaps/overlaps. Temporal stays server-side (RRULE expansion, validation) and in tests.
- Client-side form validation uses `zod/mini`; heavy UI (form panel, recurrence editor, conflict screen) is lazy-loaded. RRULE strings are built by hand on the client (no `rrule` lib in the browser).
- i18n: locale comes from the user PROFILE (cookie session), not from the URL. URL holds view/date/rooms only.
- API contract types live in `src/shared/contracts` (server imports them from shared; frontend imports them too).

---

## Architecture (frontend: feature-based)

```
src/
  app/                    # Next.js App Router: routes, layouts, route handlers (api/*)
  features/
    calendar/             # views (day/week/month/list), grid, layout algo, URL state
    events/               # event model, mutations, optimistic updates, drag/resize
    recurrence/           # rrule expansion, scope edit (this / following / all), editor (lazy)
    timezone/             # Temporal helpers, profile tz, secondary time column
    sync/                 # offline queue (IndexedDB), SSE client, conflict screen (lazy), status indicator
    history/              # undo/redo stack (20)
    event-form/           # side panel, RHF+Zod, room suggestions (debounce, stale-guard)
    auth/                 # login, session
    rooms/
    a11y/                 # keyboard grid nav, live-region announcer
  shared/                 # ui (shadcn), lib, i18n, msw handlers, config
  server/                 # backend, see below
```

Rules: features import only from `shared` and other features' public `index.ts`; enforced by ESLint boundaries.

### Backend layout (`src/server`), enforced by ESLint boundaries

```
core/      generic infrastructure, knows no domain: env, http (response/body/origin), db (client, migrate,
           columns, errors, transaction/runTx, advisory locks, migrations/)
modules/   one folder per domain, two public entry points: index.ts (domain API, no web framework) and
           http.ts (route handlers); schema.ts is also importable for foreign-key references
  auth/    schema (users, sessions), password, session, guard (authorize), handlers/ (login, logout, me)
  rooms/   schema, repository, handlers/list
  events/  schema, dto, validation, repository (SQL), materialize, errors,
           service/ (create, update, delete, series, persist, fields, extend-series), handlers/ (one file per endpoint),
           tests/ (one file per concern + api.ts client)
tools/     seed/, testing/ (db helpers, global setup, API harness), bootstrap.ts (container entrypoint)
```

core -> core/shared only; modules -> core, other modules (via index), shared; tools -> everything; app routes -> core, modules.

## Stages (each = commit)

| #   | Stage                                                                                                                                                                     | Done when                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 0   | Scaffold: Next 15, TS strict, ESLint (no-explicit-any, ban-ts-comment w/ description, no `Date` tz math rule), Prettier, Vitest, Tailwind, shadcn, next-intl, CI skeleton | `pnpm lint typecheck test` green in CI         |
| 1   | DB: Drizzle schema, migrations, exclusion constraint (`btree_gist`, `tstzrange`), version column                                                                          | migration test against real PG                 |
| 2   | Seed: 3 users (Kyiv/NY/Tokyo), 50 rooms, 2000 events (recurring, DST-crossing), idempotent                                                                                | seed runs once, re-run is no-op                |
| 3   | Auth: login, httpOnly session cookie, profile + tz change                                                                                                                 | route tests                                    |
| 4   | Events API: CRUD, `GET /events?from&to&rooms` with expanded RRULE, `PATCH version` → 409, overlap → 409 w/ blocker+creator                                                | integration tests incl. concurrent insert race |
| 5   | SSE stream + event bus; origin id so author can dedupe own echo                                                                                                           | test                                           |
| 6   | Time core: Temporal wrappers, wall-clock-in-tz recurrence expansion, DST tests (spring/autumn, Kyiv/NY/Tokyo), locale format/parse                                        | unit tests pass                                |
| 7   | i18n (uk/en): week start, 12/24h, plurals; SSR tz from profile                                                                                                            | unit tests                                     |
| 8   | Layout algo (overlap columns), deterministic                                                                                                                              | property/unit tests                            |
| 9   | URL state (view/date/rooms filter), Zustand UI store                                                                                                                      | back/forward test                              |
| 10  | Views: week + day (sticky time, 50 columns, now-line, second tz column)                                                                                                   | e2e smoke, axe                                 |
| 11  | Views: month ("+N more"), list (infinite scroll), all-day/multi-day                                                                                                       | axe                                            |
| 12  | TanStack Query: period keys, prefetch neighbours, per-event cache patch                                                                                                   | tests                                          |
| 13  | Drag create/move/resize (pointer+touch), 15-min snap, cross-day/room; no full-grid re-render                                                                              | perf test                                      |
| 14  | Keyboard: grid focus nav, Enter create, kbd drag mode, live-region announcements                                                                                          | e2e kbd                                        |
| 15  | Optimistic mutations + rollback + conflict messages (who/what)                                                                                                            | MSW tests                                      |
| 16  | Undo/redo (20, incl. server sync)                                                                                                                                         | unit + e2e                                     |
| 17  | Event form side panel (RHF+Zod), room suggestions (debounce+abort), dirty-guard, focus mgmt                                                                               | interaction tests                              |
| 18  | Recurrence editor (lazy) + scope edit this/following/all                                                                                                                  | e2e                                            |
| 19  | Offline queue (IndexedDB), ordered replay, status indicator                                                                                                               | unit (fake-indexeddb) + e2e                    |
| 20  | Conflict resolution screen (lazy) with diff                                                                                                                               | e2e                                            |
| 21  | SSE client, echo suppression, race handling for rapid actions                                                                                                             | e2e 2 browsers                                 |
| 22  | Dark theme, reduced-motion, SSR/hydration in 3 tz                                                                                                                         | e2e in 3 browsers                              |
| 23  | Storybook + MSW (shared handlers) + interaction tests                                                                                                                     | CI                                             |
| 24  | Playwright e2e (x3 runs), screenshots (3 browsers, light/dark)                                                                                                            | CI                                             |
| 25  | Perf: bundle ≤200KB gz budget, lazy chunks, Lighthouse CI (perf≥90, a11y=100), measurements                                                                               | CI                                             |
| 26  | Docker Compose (postgres, web, one-shot migrate+seed), `.env.example`                                                                                                     | acceptance #1                                  |
| 27  | README (all sections in §10, with real measurements)                                                                                                                      | acceptance #21                                 |

## Key decisions (to be recorded in README)

- Storage: events in UTC (`tstzrange`) + for recurring: `dtstart_local`, `tzid`, RRULE string; expansion in wall-clock of event tzid via Temporal → DST-stable.
- Overlap guard: DB exclusion constraint on `(room_id, tstzrange)`; recurring events conflicts checked against expanded occurrences (see Open Question 2).
- Layout: sort by (start, -end, id), greedy column assignment per cluster, width = 1/clusterMaxCols.
- Offline: op log in IndexedDB with `baseVersion`; replay in order; 409 → conflict screen.
- Undo = inverse ops pushed through the same mutation pipeline (so server stays in sync).

## Open questions

See chat. Defaults used if unanswered are marked in README "Decisions".

## Stage 1 notes (done)

- Occurrences are materialized (`event_occurrences`, exclusion constraint on `(room_id, during)`), so the DB guarantees no double-booking for recurring events too. Infinite series are materialized up to `materialized_until` (extension job, stage 4).
- Series edits: "only this" = exdate + detached event (`series_id`, `original_start`); "this and following" = UNTIL on master + new master; "all" = update master. Deleting a master cascades to its detached exceptions.
- Instants are `timestamptz` read as strings (no JS `Date`).
- Integration tests use a real Postgres (`pnpm db:up`, then `pnpm test:int`).
- Concurrency finding: simultaneous overlapping inserts can fail with `40P01` (deadlock) instead of `23P01`. Stage 4 service must retry once on `40P01`/`40001`, then map `23P01` to 409 with the blocking event.
- DST finding (seed): a wall-clock range like 02:30-03:30 on a spring-forward day collapses to zero length (02:30 does not exist). The events API (stage 4) must derive `end` as start + duration in real time, or reject ranges where end <= start after conversion; tests required.

## Stage 2 + infra notes (done, pulled forward)

- `docker compose up --build`: services `postgres`, `web`. `web` CMD runs `dist/bootstrap.mjs` (esbuild bundle: migrate + seed-if-empty, advisory-locked, idempotent) then `server.js`.
- Seed: 3 users, 50 rooms, exactly 2000 occurrences starting in the next 2 months (recurring counted per occurrence). Fixed fixtures on the real 2026 DST transitions (Kyiv, New York), a Tokyo series, an open-ended series (materialized 1 year ahead), all-day/3-day events, a detached series exception, 5 overlapping events across rooms, and a NY 23:30 call.
- Time core (pulled forward from stage 6): `src/shared/time` — rrule floating wall-clock expansion + Temporal. UNTIL is a wall-clock bound in the event's zone.

## Stage 3 notes (done)

- Auth API: `POST /api/auth/login`, `POST /api/auth/logout`, `GET/PATCH /api/me` (profile `timezone`, `locale`, `name`; strict schema, no mass assignment). Handlers are factories (`makeXHandler(deps)`) so tests inject the DB and clock; route files only wire them.
- Sessions: random 32-byte token in an httpOnly, SameSite=Lax cookie; DB stores HMAC-SHA256(SESSION_SECRET, token); expiry instant is exclusive; expired sessions purged on login. Secure flag only when APP_URL is https.
- CSRF: SameSite=Lax + Origin must match Host on mutating requests.
- Known limitation (README): no login rate limiting; no sliding session expiry. Login UI comes with the calendar page (stage 10).
- CI has a `docker` job running `scripts/ci-docker-check.sh` (clean `compose up`, seed counts, API smoke, restart does not re-seed).

## Stage 4 notes (done)

- API: `GET /api/rooms`, `GET /api/events?from&to&rooms` (expanded occurrences, max 124 days, within ±5 years), `POST /api/events`, `GET|PATCH|DELETE /api/events/:id`.
- PATCH/DELETE: `version` required (409 `VERSION_CONFLICT` with `details.current`); recurring edits take `scope` = `this` | `following` | `all` plus `occurrenceStart`. Room clash -> 409 `ROOM_CONFLICT` with `details.blockers` (title, creator, times). Deadlocks (`40P01`/`40001`) are retried (4 attempts).
- Series model: "only this" = exdate + detached event; "this and following" = old series gets UNTIL (wall-clock, 1s before), new series gets the rest (COUNT adjusted); "all" with a new time drops earlier "only this" edits. A series edit bumps the master `version`, so clients holding other occurrences of it will get a VERSION_CONFLICT and must refresh.
- Finite series are fully materialized (max 1000 occurrences); open-ended ones to +12 months and extended on read (+6 months beyond the requested end); occurrences blocked by later bookings are skipped (ON CONFLICT DO NOTHING). Known limitation: an open-ended series can lose an occurrence to a booking made beyond its horizon.
- Any signed-in user may edit any event (shared office calendar). Events are attributed to their creator; an "only this" detached event keeps the series creator.
- Dates are sent/received as ISO instants with offset; `end` is validated in real time (DST gap safe). `tzid` defaults to the creator's profile zone.
- Not yet: SSE (stage 5), `GET /api/users` for the attendee picker (stage 17).
- Concurrency finding #2: racing bookings of one slot made Postgres detect deadlocks only after its 1s timeout, repeatedly (tests hung 9-20s, intermittently). Fix: writers take a per-room advisory lock (`locks.ts`, sorted order, transaction-scoped). The exclusion constraint remains the guarantee; the lock only makes writers queue. Stress tests (30 racers, room swaps, mixed storm) fail without it and pass in ~2s with it.
