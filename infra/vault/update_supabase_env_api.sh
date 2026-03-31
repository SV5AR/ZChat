#!/usr/bin/env bash
# Update Supabase function environment variables using Supabase REST Admin API
# Requires SUPABASE_ADMIN_KEY env var and VAULT_TOKEN to fetch secrets

set -euo pipefail
VAULT_PATH=${VAULT_PATH:-secret/data/zchat}
SUPABASE_PROJECT=${SUPABASE_PROJECT:-}
SUPABASE_ADMIN_KEY=${SUPABASE_ADMIN_KEY:-}

if [ -z "$SUPABASE_PROJECT" ] || [ -z "$SUPABASE_ADMIN_KEY" ]; then echo "Set SUPABASE_PROJECT and SUPABASE_ADMIN_KEY"; exit 1; fi
if [ -z "$VAULT_TOKEN" ]; then echo "Set VAULT_TOKEN"; exit 1; fi

HMAC_KEY=$(vault kv get -field=SUPABASE_INTERNAL_HMAC_KEY $VAULT_PATH)
SERVICE_KEY=$(vault kv get -field=SUPABASE_SERVICE_ROLE_KEY $VAULT_PATH)

API_BASE="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT/functions/config"

echo "Updating function environment variables (this will overwrite existing config)"
curl -s -X POST "$API_BASE" -H "Authorization: Bearer $SUPABASE_ADMIN_KEY" -H "Content-Type: application/json" -d '{"SUPABASE_INTERNAL_HMAC_KEY": "'"$HMAC_KEY"'", "SUPABASE_SERVICE_ROLE_KEY": "'"$SERVICE_KEY"'"}'
