#!/usr/bin/env bash
# Rotate internal HMAC via rotate-internal-hmac function and push to Vault

set -euo pipefail
SUPABASE_URL=${SUPABASE_URL:-}
SUPABASE_PROJECT=${SUPABASE_PROJECT:-}
SUPABASE_TOKEN=${SUPABASE_TOKEN:-}
VAULT_PATH=${VAULT_PATH:-secret/data/zchat}
VAULT_ADDR=${VAULT_ADDR:-}

if [ -z "$SUPABASE_TOKEN" ] || [ -z "$SUPABASE_PROJECT" ]; then echo "Set SUPABASE_TOKEN and SUPABASE_PROJECT"; exit 1; fi

echo "Calling rotate-internal-hmac"
KEY_JSON=$(curl -s -H "Authorization: Bearer $SUPABASE_TOKEN" -H "Content-Type: application/json" -d '{}' "https://$SUPABASE_PROJECT.functions.supabase.co/rotate-internal-hmac")
KEY=$(echo "$KEY_JSON" | jq -r .key)
KEY_ID=$(echo "$KEY_JSON" | jq -r .key_id)

echo "Storing new key in Vault"
vault kv put $VAULT_PATH SUPABASE_INTERNAL_HMAC_KEY="$KEY" INTERNAL_KEY_ID="$KEY_ID"

echo "Operator must update Supabase Function env vars to use new key"
if [ -n "${SUPABASE_ADMIN_KEY:-}" ] && [ -n "${SUPABASE_PROJECT:-}" ]; then
  echo "Updating Supabase function envs via API"
  VAULT_TOKEN=${VAULT_TOKEN:-}
  ./infra/vault/update_supabase_env_api.sh
fi
