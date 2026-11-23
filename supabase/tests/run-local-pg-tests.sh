#!/usr/bin/env bash
# Runs all Supabase migrations, seed.sql, and SQL security/business-rule tests
# against a temporary local PostgreSQL 16 instance (no Docker required),
# or against $DATABASE_URL if provided.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Running SQL tests against DATABASE_URL..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/tests/01_security_and_rules.sql"
  exit 0
fi

PG_BIN=""
for candidate in "/usr/local/opt/postgresql@16/bin" "/opt/homebrew/opt/postgresql@16/bin" "$(dirname "$(command -v initdb 2>/dev/null || true)")"; do
  if [[ -n "$candidate" && -x "$candidate/initdb" && -x "$candidate/pg_ctl" && -x "$candidate/psql" ]]; then
    PG_BIN="$candidate"
    break
  fi
done

if [[ -z "$PG_BIN" ]]; then
  echo "ERROR: PostgreSQL binaries (initdb, pg_ctl, psql) not found. Set DATABASE_URL or install postgresql@16." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/anjuman_khata_pg.XXXXXX)"
cleanup() {
  if [[ -d "$TMP_DIR/data" && -f "$TMP_DIR/data/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/data" "$TMP_DIR/sock"
"$PG_BIN/initdb" -D "$TMP_DIR/data" -A trust -U postgres --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -l "$TMP_DIR/pg.log" -o "-k $TMP_DIR/sock -h ''" start >/dev/null

PSQL="$PG_BIN/psql -h $TMP_DIR/sock -U postgres -v ON_ERROR_STOP=1"

# Minimal Supabase auth schema & roles shim matching hosted Supabase Postgres
$PSQL <<'SQL'
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
SQL

for f in "$ROOT_DIR"/supabase/migrations/*.sql; do
  echo "=== Applying $(basename "$f") ==="
  $PSQL -f "$f" >/dev/null
done

echo "=== Applying seed.sql ==="
$PSQL -f "$ROOT_DIR/supabase/seed.sql" >/dev/null

for t in "$ROOT_DIR"/supabase/tests/*.sql; do
  echo "=== Running $(basename "$t") ==="
  $PSQL -f "$t"
done

echo "✅ All PostgreSQL migrations, seed, and SQL security/business-rule tests passed!"
