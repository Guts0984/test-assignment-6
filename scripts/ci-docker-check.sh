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
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = "200" ] && break
  sleep 2
done
expect "web answers 200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" "200"

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
expect "profile time zone change" "$(api -X PATCH -d '{"timezone":"Asia/Tokyo"}' "$BASE/api/me" | grep -o '"timezone":"[^"]*"')" '"timezone":"Asia/Tokyo"'
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
