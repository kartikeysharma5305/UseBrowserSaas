#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/tmp/phase6a-database.env
SCHEMA_NAME=phase6a_runtime
database_url="$(
  cd "$ROOT"
  node --env-file=.env.local -e \
    'process.stdout.write(process.env.DATABASE_URL || "")'
)"
if [[ -z "$database_url" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi
runtime_url="$(
  DATABASE_URL="$database_url" SCHEMA_NAME="$SCHEMA_NAME" node -e \
    'const url=new URL(process.env.DATABASE_URL);url.searchParams.set("schema",process.env.SCHEMA_NAME);process.stdout.write(url.href)'
)"

if [[ "${1:-}" == "stop" ]]; then
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -c "DROP SCHEMA IF EXISTS \"$SCHEMA_NAME\" CASCADE;" >/dev/null
  rm -f "$ENV_FILE"
  exit 0
fi

psql "$database_url" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS \"$SCHEMA_NAME\" CASCADE;" >/dev/null
psql "$database_url" -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA \"$SCHEMA_NAME\";" >/dev/null
umask 077
printf 'DATABASE_URL=%s\n' "$runtime_url" >"$ENV_FILE"
printf '{"schema":"phase6a_runtime","ready":true}\n'
