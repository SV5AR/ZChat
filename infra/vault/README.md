Vault integration guide (placeholder)

This describes how to integrate HashiCorp Vault for secret storage and automated rotation.

1) Set up Vault with KV v2 and create a path `secret/data/zchat`.
2) Store `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_INTERNAL_HMAC_KEY` at that path.
3) Create an operator script that fetches the latest keys and updates Supabase Function envs via the Supabase API.

Example update flow (operator):
- Fetch new key from Vault: `vault kv get -format=json secret/zchat | jq -r .data.data.SUPABASE_INTERNAL_HMAC_KEY`
- Use Supabase REST API to update function config or use `supabase functions deploy` with env vars set.
