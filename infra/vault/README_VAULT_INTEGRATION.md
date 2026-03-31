Vault integration steps

1) Install Vault and initialize a KV v2 engine.
2) Create a policy and token for an operator that can write secrets to `secret/data/zchat`.
3) Use `infra/vault/deploy_rotate.sh` to call `rotate-internal-hmac` (admin-only) and store the returned key into Vault.
4) Use `infra/vault/update_supabase_env.sh` (manual step) to export keys into the Supabase functions environment variables. Operator must ensure secure transfer.

Notes:
- For production, use an automated operator running in CI with proper IAM and secure tokens; never expose Vault tokens in repo.
