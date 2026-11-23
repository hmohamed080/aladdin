#!/usr/bin/env bash
# Runs DRAFT_m3a_pending_registration_transition_proof.sql in a throwaway postgres:17 container. No Supabase, no hosted project, no files outside the container.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="p1m3a-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=proof postgres:17 >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 2
# The SQL goes in on stdin, so no host path has to be understood by docker (works from Git Bash on Windows too).
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -f - < "$here/DRAFT_m3a_pending_registration_transition_proof.sql" 2>&1
