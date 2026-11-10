#!/usr/bin/env bash
# Acceptance #1 as a script: a clean `docker compose up --build` must come up, migrate, seed once,
# and serve the API. Run from the repo root after `cp .env.example .env`.
# Optional overrides for local runs next to a dev stack: COMPOSE_PROJECT_NAME, WEB_PORT, POSTGRES_PORT.
set -euo pipefail

override_pg_port="${POSTGRES_PORT:-}"
set -a; . ./.env; set +a
[ -z "$override_pg_port" ] || export POSTGRES_PORT="$override_pg_port"
WEB_PORT="${WEB_PORT:-3000}"
BASE="http://localhost:${WEB_PORT}"
JAR="$(mktemp)"
fail() { echo "FAIL: $*" >&2; docker compose logs --no-color web | tail -40 >&2; exit 1; }
sql() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$1"; }
expect() { [ "$2" = "$3" ] || fail "$1: expected '$3', got '$2'"; echo "ok  $1"; }
api() { curl -s -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' "$@"; }

docker compose up --build -d

for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login" || true)" = "200" ] && break
  sleep 2
done
expect "login page answers 200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")" "200"
expect "offline service worker is served (/sw.js)" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/sw.js")" "200"
expect "anonymous / redirects to /login" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/")" "307 ${BASE}/login"

expect "3 users"  "$(sql 'select count(*) from users')" "3"
expect "50 rooms" "$(sql 'select count(*) from rooms')" "50"
expect "2000 occurrences in the 2 months after the seed hour" "$(sql "
  with w as (select date_trunc('hour', min(created_at) at time zone 'UTC') as s from users)
  select count(*) from event_occurrences o, w
  where (lower(o.during) at time zone 'UTC') >= w.s and (lower(o.during) at time zone 'UTC') < w.s + interval '2 months'")" "2000"

expect "anonymous /api/me is 401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/me")" "401"
expect "wrong password is 401" "$(api -o /dev/null -w '%{http_code}' -d '{"email":"ana@example.com","password":"wrong-pass"}' "$BASE/api/auth/login")" "401"
expect "login is 200" "$(api -o /dev/null -w '%{http_code}' -d "{\"email\":\"ana@example.com\",\"password\":\"${SEED_USER_PASSWORD}\"}" "$BASE/api/auth/login")" "200"
expect "/api/me returns Ana" "$(api "$BASE/api/me" | grep -o '"email":"[^"]*"')" '"email":"ana@example.com"'
# --- events API on the seeded data
FROM="$(sql "select to_char(date_trunc('hour', min(created_at) at time zone 'UTC'), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') from users")"
TO="$(sql "select to_char(date_trunc('hour', min(created_at) at time zone 'UTC') + interval '2 months', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') from users")"
EXPECTED="$(sql "select count(*) from event_occurrences where during && tstzrange('$FROM', '$TO', '[)')")"
GOT="$(api "$BASE/api/events?from=$FROM&to=$TO" | grep -o '"eventId"' | wc -l | tr -d ' ')"
expect "GET /api/events returns every seeded occurrence of the window" "$GOT" "$EXPECTED"
expect "50 rooms via the API" "$(api "$BASE/api/rooms" | grep -o '"floor"' | wc -l | tr -d ' ')" "50"
ROOM="$(sql 'select id from rooms order by name limit 1')"
BOOKING="{\"roomId\":\"$ROOM\",\"title\":\"CI booking\",\"startAt\":\"2031-05-05T09:00:00Z\",\"endAt\":\"2031-05-05T10:00:00Z\"}"
expect "create a booking is 201" "$(api -o /dev/null -w '%{http_code}' -d "$BOOKING" "$BASE/api/events")" "201"
CLASH="$(api -w ' %{http_code}' -d "$BOOKING" "$BASE/api/events")"
expect "the same booking again is 409" "${CLASH##* }" "409"
echo "$CLASH" | grep -q 'ROOM_CONFLICT' || fail "409 body has no ROOM_CONFLICT"
echo "$CLASH" | grep -q 'CI booking' || fail "409 body does not name the blocking event"
EVENT_ID="$(sql "select id from events where title = 'CI booking'")"
expect "delete the booking is 200" "$(api -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/events/$EVENT_ID?version=1")" "200"
expect "nothing left of it" "$(sql "select count(*) from events where title = 'CI booking'")" "0"

expect "users list via the API" "$(api "$BASE/api/users" | grep -o '"timezone"' | wc -l | tr -d ' ')" "3"
STREAM="$(curl -s -N --max-time 3 -b "$JAR" "$BASE/api/stream" || true)"
echo "$STREAM" | grep -q 'event: hello' || fail "SSE stream did not greet the client"
echo "ok  SSE stream answers with hello"
expect "profile time zone change" "$(api -X PATCH -d '{"timezone":"Asia/Tokyo"}' "$BASE/api/me" | grep -o '"timezone":"[^"]*"')" '"timezone":"Asia/Tokyo"'
api -o /dev/null -X PATCH -d '{"timezone":"Europe/Kyiv"}' "$BASE/api/me" # leave the seeded profile as it was
expect "logout is 200" "$(api -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/logout")" "200"
expect "after logout /api/me is 401" "$(api -o /dev/null -w '%{http_code}' "$BASE/api/me")" "401"

docker compose restart web >/dev/null
for _ in $(seq 1 60); do
  docker compose logs --no-color web | grep -q 'already seeded' && break
  sleep 1
done
docker compose logs --no-color web | grep -q 'already seeded' || fail "second start did not skip the seed"
expect "restart did not re-seed" "$(sql 'select count(*) from users')" "3"
echo "docker check passed"
