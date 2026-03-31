Monitoring & Alerting

This folder describes how to integrate monitoring for ZChat using Postgres metrics and webhooks.

1) Enable `pg_stat_statements` (done) and configure query logging in Supabase if available.
2) Use the `metrics` table and `alerting` function to forward signals to your webhook.
3) Example Slack payloads: send JSON with `text` field.

Example cron for sending daily summary to Slack:
curl -X POST -H 'Content-Type: application/json' -d '{"text":"Daily summary: X auth fails, Y rate limits"}' $ALERT_WEBHOOK_URL
