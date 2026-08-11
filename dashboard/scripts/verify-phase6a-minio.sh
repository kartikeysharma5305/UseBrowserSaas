#!/usr/bin/env bash
set -euo pipefail

BIN=/tmp/phase6a-minio
MC_BIN=/tmp/phase6a-mc
DATA=/tmp/phase6a-minio-data
ENV_FILE=/tmp/phase6a-minio.env
PID_FILE=/tmp/phase6a-minio.pid
LOG_FILE=/tmp/phase6a-minio.log

stop_minio() {
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      wait "$pid" 2>/dev/null || true
    fi
  fi
  rm -rf "$DATA" "$ENV_FILE" "$PID_FILE" "$LOG_FILE"
}

if [[ "${1:-}" == "stop" ]]; then
  stop_minio
  exit 0
fi

if [[ "${1:-}" == "audit-cleanup" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
  "$MC_BIN" alias set phase6a http://127.0.0.1:9000 \
    "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  before="$("$MC_BIN" ls --recursive --json phase6a/phase6a-artifacts | wc -l)"
  policy="$("$MC_BIN" anonymous get phase6a/phase6a-artifacts 2>&1 || true)"
  "$MC_BIN" rm --recursive --force phase6a/phase6a-artifacts >/dev/null
  after="$("$MC_BIN" ls --recursive --json phase6a/phase6a-artifacts | wc -l)"
  if grep -qi private <<<"$policy"; then
    private=true
  else
    private=false
  fi
  printf '{"objectsBeforeCleanup":%s,"objectsAfterCleanup":%s,"private":%s}\n' \
    "$before" "$after" "$private"
  exit 0
fi

stop_minio
curl -fsSL \
  https://dl.min.io/server/minio/release/linux-amd64/minio \
  -o "$BIN"
chmod 700 "$BIN"
mkdir -m 700 "$DATA"
access="phase6a$(date +%s)"
secret="$(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32)"
umask 077
{
  printf 'MINIO_ROOT_USER=%s\n' "$access"
  printf 'MINIO_ROOT_PASSWORD=%s\n' "$secret"
  printf 'S3_ACCESS_KEY_ID=%s\n' "$access"
  printf 'S3_SECRET_ACCESS_KEY=%s\n' "$secret"
} >"$ENV_FILE"

set -a
source "$ENV_FILE"
set +a
nohup "$BIN" server "$DATA" \
  --address 127.0.0.1:9000 \
  --console-address 127.0.0.1:9001 \
  >"$LOG_FILE" 2>&1 &
echo "$!" >"$PID_FILE"

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null; then
    curl -fsSL \
      https://dl.min.io/client/mc/release/linux-amd64/mc \
      -o "$MC_BIN"
    chmod 700 "$MC_BIN"
    "$MC_BIN" alias set phase6a http://127.0.0.1:9000 \
      "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    "$MC_BIN" mb --ignore-existing phase6a/phase6a-artifacts >/dev/null
    printf '{"ready":true,"endpoint":"http://127.0.0.1:9000"}\n'
    exit 0
  fi
  sleep 1
done

echo "MinIO did not become ready." >&2
exit 1
