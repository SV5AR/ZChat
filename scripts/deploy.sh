#!/usr/bin/env bash
set -euo pipefail
# Simple deploy helper for this repo.
# Usage: PROJECT_REF=... ZCHAT_SUPABASE_URL=... ZCHAT_SERVICE_ROLE_KEY=... ZCHAT_JWT_SECRET=... DATABASE_URL=... ./scripts/deploy.sh

PROJECT_REF=${PROJECT_REF:-}
ZCHAT_SUPABASE_URL=${ZCHAT_SUPABASE_URL:-}
ZCHAT_SERVICE_ROLE_KEY=${ZCHAT_SERVICE_ROLE_KEY:-}
ZCHAT_JWT_SECRET=${ZCHAT_JWT_SECRET:-}
ZCHAT_AUTH_SERVER_KEYS=${ZCHAT_AUTH_SERVER_KEYS:-}
ZCHAT_ACTIVE_SERVER_KEY_ID=${ZCHAT_ACTIVE_SERVER_KEY_ID:-}
DATABASE_URL=${DATABASE_URL:-}

if [[ -z "$PROJECT_REF" || -z "$ZCHAT_SUPABASE_URL" || -z "$ZCHAT_SERVICE_ROLE_KEY" || -z "$ZCHAT_JWT_SECRET" ]]; then
  echo "Missing required environment variables. Please set: PROJECT_REF, ZCHAT_SUPABASE_URL, ZCHAT_SERVICE_ROLE_KEY, ZCHAT_JWT_SECRET"
  echo "Optional: DATABASE_URL, ZCHAT_AUTH_SERVER_KEYS, ZCHAT_ACTIVE_SERVER_KEY_ID"
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found in PATH. Please install from https://supabase.com/docs/guides/cli"
  exit 1
fi

echo "Setting function secrets via supabase CLI (project: $PROJECT_REF)"
supabase secrets set ZCHAT_SUPABASE_URL="$ZCHAT_SUPABASE_URL" ZCHAT_SERVICE_ROLE_KEY="$ZCHAT_SERVICE_ROLE_KEY" ZCHAT_JWT_SECRET="$ZCHAT_JWT_SECRET" --project-ref "$PROJECT_REF" || true
if [[ -n "$ZCHAT_AUTH_SERVER_KEYS" ]]; then
  supabase secrets set ZCHAT_AUTH_SERVER_KEYS="$ZCHAT_AUTH_SERVER_KEYS" --project-ref "$PROJECT_REF" || true
fi
if [[ -n "$ZCHAT_ACTIVE_SERVER_KEY_ID" ]]; then
  supabase secrets set ZCHAT_ACTIVE_SERVER_KEY_ID="$ZCHAT_ACTIVE_SERVER_KEY_ID" --project-ref "$PROJECT_REF" || true
fi

echo "Deploying Supabase edge functions..."
for fn in supabase/functions/*; do
  if [[ -d "$fn" ]]; then
    name=$(basename "$fn")
    echo "--> Deploying: $name"
    supabase functions deploy "$name" --project-ref "$PROJECT_REF"
  fi
done

if [[ -n "$DATABASE_URL" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql not found; skipping SQL migrations. To apply migrations, install psql or run them from the dashboard."
  else
    echo "Applying SQL migrations from supabase/migrations"
    for sql in $(ls -1 supabase/migrations/*.sql | sort); do
      echo "--> Applying: $sql"
      PGPASSWORD="${PGPASSWORD:-}" psql "$DATABASE_URL" -f "$sql"
    done
  fi
else
  echo "DATABASE_URL not provided — skipping SQL migrations. You can apply files in supabase/migrations via psql or the dashboard."
fi

# quick smoke test
FUNC_BASE="${ZCHAT_SUPABASE_URL/\.supabase.co/.functions.supabase.co}/auth-signin"
echo "Running quick health check against: $FUNC_BASE/health"
curl -sS -D - "$FUNC_BASE/health" || true

echo "Done. Check function logs with: supabase functions logs <name> --project-ref $PROJECT_REF"

echo "If you want me to run this script from here, provide the required env vars and confirm."
