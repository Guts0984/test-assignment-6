# Room booking calendar

A meeting-room booking calendar: day / week / month / list views, creating and moving events with mouse,
touch and keyboard, recurring events, time zones, optimistic updates with undo/redo, an offline queue with a
conflict chooser, and live updates over SSE.

Stack: Next.js 16 (App Router) · React 19 · TypeScript (strict) · TanStack Query · Zustand · React Hook Form +
Zod · Tailwind + shadcn/ui · next-intl · Temporal (`@js-temporal/polyfill`) · rrule · PostgreSQL 16 + Drizzle ·
Storybook + MSW · Vitest + Testing Library · Playwright + axe · Lighthouse CI.

## Run it

```bash
cp .env.example .env     # the only manual step
docker compose up --build
```

Open <http://localhost:3000>. The `web` container applies the migrations and seeds the database **once**
(3 users, 50 rooms, 2 000 meetings in the next two months, recurring series, and meetings placed on the next real clock changes of Kyiv and New York — computed from the time zone database, so they are ahead of you whenever you seed; a window that starts today cannot itself contain one except in March/October–November); restarting does
not seed again. Sign in with `ana@example.com` (Kyiv), `bob@example.com` (New York) or `kenji@example.com`
(Tokyo); the password is `SEED_USER_PASSWORD` from `.env` (`demo1234` by default).

All configuration lives in `.env.example`. `src/server/core/env.ts` validates it with zod; only non-secrets have
defaults.

`docker compose up` does not publish PostgreSQL on the host (so a PostgreSQL already running on port 5432
cannot stop it); `pnpm db:up` adds `docker-compose.dev.yml`, which does, for development and the
integration tests. The `web` container has a health check, and its entrypoint restarts the container if the
server stops answering (Docker alone only restarts a process that has exited).

### Development

```bash
pnpm install
pnpm db:up                # postgres from docker compose, published on 127.0.0.1:5432 (docker-compose.dev.yml)
pnpm dev
```

## Tests

| What                                            | Command                                                    | Notes                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint, types, formatting                         | `pnpm lint`, `pnpm typecheck`, `pnpm format:check`         | ESLint also enforces the module boundaries and bans `any`, `Date` for zone maths, classes                                                                                  |
| unit + component (Vitest, Testing Library, MSW) | `pnpm test:unit`                                           | pure logic, sync engine, hooks against the mocked API                                                                                                                      |
| integration (real PostgreSQL)                   | `pnpm test:int`                                            | needs `pnpm db:up`; each run uses its own temporary database (parallel runs are safe); races, DST, series scopes                                                           |
| Storybook + interaction tests                   | `pnpm storybook`; `pnpm test-storybook`                    | builds Storybook, serves the static build on :6006 and runs every story's interaction test (never run it against the dev server: a cold Vite start reloads pages mid-test) |
| e2e (Playwright, 3 browsers)                    | `BASE_URL=http://localhost:3000 pnpm exec playwright test` | against a running stack; repeatable on the same stack without a restart                                                                                                    |
| screenshot tests                                | `pnpm test:screenshots`                                    | 3 browsers × light/dark; baselines come from the Playwright Docker image (see below)                                                                                       |
| first-load JS budget                            | `node scripts/measure-js.mjs http://localhost:3000`        | gzip size of every script the calendar loads                                                                                                                               |
| Lighthouse CI                                   | `pnpm lighthouse`                                          | performance ≥ 90, accessibility = 100, scripts ≤ 200 KB                                                                                                                    |

Screenshot baselines depend on fonts and anti-aliasing, so they are produced and compared inside
`mcr.microsoft.com/playwright:v1.65.0-noble` (CI does the same). To refresh them after an intended visual change:

```bash
docker run --rm --network host --ipc=host -v "$PWD":/work -w /work -e BASE_URL=http://localhost:3000 \
  mcr.microsoft.com/playwright:v1.65.0-noble npx playwright test -c playwright.screenshots.config.ts --update-snapshots
```

WebKit does not launch on every Linux host; running the whole e2e suite in the same image works everywhere.

CI (`.github/workflows/ci.yml`), jobs that run in parallel: `static` (lint, types, formatting, unit), `integration`,
`storybook` (build + interaction tests), `e2e` (one job per browser — chromium, firefox, webkit — each with its
own docker-compose stack, the suite three times in a row without a restart), `screenshots` (3 browsers ×
light/dark), `performance` (JS budget + Lighthouse), `docker` (clean `compose up` smoke test: migrations,
one-time seed, API, SSE, restart).

## Architecture

```
src/
  app/                 routes, layouts, route handlers (api/*) — thin: they call the server modules
  server/
    core/              env, http helpers, db client/transactions/locks/migrations (no domain knowledge)
    modules/           auth, rooms, events, realtime — each: index.ts (domain API), http.ts (handlers), schema
    tools/             seed, bootstrap (migrate + seed once), test harness
  features/            frontend, one folder per feature
    calendar/          views, grid components, pure domain logic (grid, layout, ranges, gestures), UI state
    events/            query cache, optimistic runtime, undo/redo history
    sync/              offline queue engine, IndexedDB storage, SSE client, conflict screen
    event-form/        side panel (RHF + Zod), recurrence editor, free-room suggestions
    auth/
  shared/              contracts (API types), zoned (time zone engine), time, i18n, api client, mocks
```

The backend is Next.js route handlers in the same project, as the assignment asks.

## How time and recurrence are stored

- **Instants** are stored in UTC (`timestamptz`). Every event also stores the **IANA zone it was created in**
  (`tzid`); the viewer's own zone comes from the profile, never from the browser.
- **Recurrence** is an RRULE string plus the series' first start and `tzid`. It is expanded on the server with
  the `rrule` library in "floating" wall-clock mode: the rule is evaluated on the _local_ clock of `tzid`
  (through Temporal), so "every Monday 09:00 Kyiv" stays 09:00 Kyiv before and after the DST change, while the
  UTC instants move by an hour. DST gaps (a non-existent 02:30) are resolved forward, overlaps (an hour that
  happens twice) take the first occurrence; both rules are pinned by integration tests.
- **Materialization.** Each occurrence is a row in `event_occurrences` with a `tstzrange`. Finite series are
  fully materialized; open-ended ones up to +12 months and extended when a read goes past the horizon.
  A PostgreSQL **exclusion constraint** on `(room_id, during)` (`btree_gist`) makes a double booking impossible
  even under concurrent requests; bookings also take a per-room advisory lock (rooms sorted, so no deadlocks),
  and a deadlock/serialization failure is retried.
- **Editing a series.** _Only this_ adds an exception date to the series and a detached event for the changed
  occurrence. _This and following_ ends the old series just before the occurrence (`UNTIL`) and starts a new
  series. _All_ edits the master. Every change is versioned; a stale version is a `409`.
- **All-day events** are dates in the event's own zone, so "Office closed on Mar 29" does not slide to Mar 28
  for someone in New York.
- **No `Date` for zone maths.** The browser cannot afford the Temporal polyfill in the first load (47 KB gzip),
  so the client uses `src/shared/zoned`, a small `Intl`-based zone engine over plain numbers. It is
  differentially tested against Temporal, including DST gaps and overlaps. Temporal stays on the server.
- **First paint** is rendered on the server in the _profile_ zone and 12/24 h style, which are also formatted by
  hand (no ICU differences between server and browser), so there are no hydration mismatches in any browser or
  browser zone (tested for 3 browsers × 3 zones).

## Layout of overlapping events

`layoutColumn` (`features/calendar/domain/layout.ts`) places events of one column (a day, or a room) side by
side:

1. Sort by (start, longer first, id), so the result depends on the _set_ of events, not on arrival order.
2. Split into clusters of transitively overlapping events.
3. Pack each event greedily into the first free sub-column. A cluster whose widest point has N overlapping
   events uses exactly N sub-columns (optimal for interval graphs).
4. Let an event widen over free sub-columns to its right.

A short event is drawn at least 24 px tall (the WCAG 2.2 target size), so the layout treats it as that many
minutes long and never lets two drawn blocks cover each other. In the month view a day shows what fits and
collapses the rest into "N more", which opens that day.

## Offline queue and conflicts

- Every change is a **command** (create / update / delete) with the version the user saw. Commands are written
  to **IndexedDB before** they are sent, so they survive a reload (a service worker lets the page itself load
  offline in production).
- The engine sends commands **one at a time, in order**. Later commands for the same event use the version
  chained from the previous one, so two quick edits cannot conflict with themselves. Network failures retry
  with a back-off (2 s → 30 s); a wake-up that arrives while a send is in flight is remembered (found by a
  property test with a fake server and fake clock).
- A **create** carries a client-chosen UUID, so replaying it after a lost response is idempotent (`200
replayed`, no second event, no second SSE message).
- An offline **update/delete** whose event changed meanwhile opens the **conflict screen**: both versions side
  by side, differing fields highlighted, _keep mine_ (re-applied on top of the server version) or _use the
  server's_ (my change is dropped). It cannot be dismissed without choosing, because an unresolved conflict
  blocks the rest of the queue. A conflict while online is a plain rejection: roll back and say who is in the
  way. The screen is loaded lazily.
- **Optimistic updates** are pure functions on the cached periods with a rollback snapshot. **Undo/redo** keeps
  20 actions and re-issues them as ordinary commands, so they sync and conflict-check like anything else.
- **SSE** (`/api/stream`) carries other people's changes into the cache. A change that matches what we already
  show (our own echo) is ignored by version, so nothing flickers; events with local pending commands are
  skipped until those are settled.

## Performance

Measured on a laptop with the production build (`docker compose` image), Chromium:

| What                                                    | Result                                                                   | Budget                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| First-load JS of `/calendar` (gzip)                     | **178 KB**                                                               | ≤ 200 KB                               |
| Lighthouse, mobile preset, 3 runs per view              | performance 0.98–1.00, accessibility 1.00                                | ≥ 0.90 / = 1.00                        |
| Lighthouse LCP / CLS / TBT                              | ~0.8–1.1 s / ≈ 0 / 80–150 ms                                             | —                                      |
| Week with 2 000 meetings: drag, worst interaction (INP) | ~110 ms                                                                  | < 200 ms                               |
| Week with 2 000 meetings: frame time while dragging     | median 16.7 ms (60 fps), p95 33 ms (about 50 ms on the 2-core CI runner) | median < 20 ms, p95 ≤ 67 ms (asserted) |
| Day with 50 rooms: drag, INP / frame p95                | 32–40 ms / 16.7 ms                                                       | < 200 ms                               |

What made it fit:

- **Bundle**: the 200 KB budget was the main design constraint, so heavy code is kept out of the first load:
  Temporal and `rrule` are server-only, the zone engine is a few KB, client validation uses `zod/mini`, and the
  form panel, recurrence editor, conflict screen and settings dialog are lazy chunks.
- **No full-grid repaint.** Blocks are memoized on plain values; a drag redraws only a ghost, and a drop
  redraws only the changed event and its column. The first version rebuilt the segments of all 2 000 events on
  every drop (INP 168 ms, p95 frame 66 ms in the same test); segments are now remembered per event object and
  columns compare their segments, which removed that.
- **Cached periods** (one query per visible range) are patched in place; neighbouring ranges are prefetched.
- Zustand selectors are narrow (a block subscribes only to "am I selected / dragged").

## Accessibility and i18n

- axe runs in e2e on all four views in light and dark, plus the panel, settings and scope dialogs, including the
  WCAG 2.2 target-size rule (Lighthouse found a violation that the default axe rule set missed; both now check
  it). Dialogs are native `<dialog>`: focus is trapped, moved to the right control on open and returned on close.
- Everything that can be done with the mouse can be done with the keyboard: arrow keys move a cursor over the
  grid, Enter/Space picks up, moves, resizes and drops an event, Escape cancels; every step is announced in a
  live region. Touch uses press-and-hold (300 ms) so scrolling still works.
- Languages: Ukrainian (default) and English, with ICU plurals (`messages/*.json`, checked by a test that
  compares placeholders between catalogs). Week start (Monday / Sunday) and the 12/24 h clock follow the profile.

## Decisions and known limitations

- **Next.js 16** (the assignment says 15+). pnpm 12, Node 24.
- **Locale and zone come from the profile** (cookie session), not from the URL; the URL holds view, date and rooms.
- **Auth** is a minimal session (scrypt passwords, HMAC-hashed session tokens in the database, httpOnly cookie).
  There are no roles; every signed-in user may edit any event (the creator and attendees are recorded and shown).
- **Sign-in rate limit.** There is deliberately **no limit per account**: any limit that counts failures for an
  e-mail address can be used by a stranger who knows it (here every signed-in user can see everybody's) to keep
  the owner from signing in, and an attacker can only be told apart by where they come from. The app can know
  that only behind reverse proxies of its own, so with `TRUSTED_PROXY_HOPS` set to their number, one network
  address may fail 100 times per 15 minutes and then gets a 429 with `Retry-After`, for every account, even with
  the right password; other addresses are unaffected, and a successful sign-in does not reset the count. The
  address is the entry your outermost proxy appended to `X-Forwarded-For`, counted from the end of the header, so
  anything the client wrote before it is ignored. Without proxies (the default) the header is **not believed at
  all** (a directly connected client controls it, and Next.js adds the socket address only when the client sent
  none): the limit is off and guessing is only slowed by the cost of the password hash. The counts are kept in
  PostgreSQL (`login_failures`), so they survive restarts and are shared by every instance.
- **The conflict screen only appears for offline commands**; an online conflict is a rejection with the blocking
  event named, as the assignment describes for the two-browser case.
- **Recurring events cannot be expanded in the browser** (that would need `rrule` in the first load): when a
  series changes, the affected cached periods are refetched instead of patched.
- **Realtime** is a single SSE stream per tab, with a `Last-Event-ID` replay for short disconnects; beyond the
  replay window the client refetches.
- **Screenshot baselines** are tied to the Playwright image version; bump the image tag, `@playwright/test` and
  the baselines together.
- **Performance numbers** come from one machine; CI asserts the budgets, not these exact values.
- **Series edits.** Moving a whole series carries its exceptions along (a removed occurrence stays removed,
  an "only this" edit stays attached); they are dropped only if the rule or zone changes. "This and following"
  moves the "only this" edits of the continuing part to the new series. A series cannot be split at an
  occurrence that a clock change pushed to another time of day (03:30 on a night without a 03:30): the new
  series would keep the pushed time for good, so the server refuses with a 400 and the neighbouring
  occurrence works.
- **Undo of "only this".** The server decides the id of the detached event, so undo is possible only once it
  has answered (offline, a message asks to wait until the change is saved).
- **Offline.** Once the page is idle it asks the service worker to download every build file (list
  generated after the build; not during install, so the worker still takes control of the page at once), so the lazily loaded panel, dialogs and repeat editor open offline too. The page itself does not
  load them early, so the first-load budget is unaffected. If one still cannot be loaded, a message is shown
  instead of an error page. The queue in IndexedDB is kept per tab; a tab adopts the queue of tabs that
  were closed with changes still waiting (Web Locks tell which tabs are alive).
- **Second time axis** shows the hours of the first visible day. For a zone with a half-hour offset the
  minutes are shown; if one of the two zones changes its clock in the middle of the week, the later days of
  that week are off by an hour on that axis (the main axis and the events are always right).
- **Not implemented**: roles, e-mail invitations, attachments (not in the assignment).
