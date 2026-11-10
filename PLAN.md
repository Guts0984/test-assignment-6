# PLAN — Room booking calendar

Source of truth: `test-assignment-6.md`. Where the assignment says something, we do exactly that.
Workflow: one stage = one small, reviewable commit (CI green on each). Tests are written to find bugs
(edge cases, DST boundaries, races), not to inflate coverage.

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
  server/                 # db (drizzle schema/migrations/seed), services, sse bus, auth
```

Rules: features import only from `shared` and other features' public `index.ts`; enforced by ESLint boundaries.

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
