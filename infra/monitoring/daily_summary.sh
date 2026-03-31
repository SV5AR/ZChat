#!/usr/bin/env bash
# Query metrics for daily summary and send to ALERT_WEBHOOK_URL
SUPABASE_PROJECT=${SUPABASE_PROJECT:-}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}

if [ -z "$SUPABASE_PROJECT" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$ALERT_WEBHOOK_URL" ]; then
  echo "Set SUPABASE_PROJECT, SUPABASE_ANON_KEY, ALERT_WEBHOOK_URL"; exit 1
fi

TODAY=$(date -I)
API="https://$SUPABASE_PROJECT.supabase.co/rest/v1/metrics?select=metric,value,created_at&created_at=gt.${TODAY}"
curl -s "$API" -H "apikey: $SUPABASE_ANON_KEY" | jq '.' | curl -s -X POST -H 'Content-Type: application/json' -d '{"text":"Daily metrics"}' $ALERT_WEBHOOK_URL
