#!/usr/bin/env bash
# Operator helper: fetch keys from Vault and update Supabase function envs via Supabase REST API

set -euo pipefail
VAULT_PATH=${VAULT_PATH:-secret/data/zchat}
SUPABASE_PROJECT=${SUPABASE_PROJECT:-}
SUPABASE_API=${SUPABASE_API:-https://api.supabase.com}

if [ -z "$SUPABASE_PROJECT" ]; then echo "Set SUPABASE_PROJECT"; exit 1; fi
if [ -z "$VAULT_TOKEN" ]; then echo "Set VAULT_TOKEN"; exit 1; fi

HMAC_KEY=$(vault kv get -field=SUPABASE_INTERNAL_HMAC_KEY $VAULT_PATH)
SERVICE_KEY=$(vault kv get -field=SUPABASE_SERVICE_ROLE_KEY $VAULT_PATH)

echo "Fetched keys from Vault; now update Supabase function envs (operator must have supabase API token in SUPABASE_TOKEN)"

# This is a placeholder — supabase API requires using the dashboard or the CLI to set secrets
echo "SUPABASE_INTERNAL_HMAC_KEY=$HMAC_KEY"
echo "SUPABASE_SERVICE_ROLE_KEY=***REDACTED***"
