CREATE TABLE IF NOT EXISTS public.action_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT action_nonces_nonce_hex CHECK (nonce ~ '^[0-9a-f]{16,128}$'),
  CONSTRAINT action_nonces_action_nonce_unique UNIQUE (user_id, action, nonce)
);

CREATE INDEX IF NOT EXISTS idx_action_nonces_expires_at ON public.action_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_action_nonces_user_action_created ON public.action_nonces(user_id, action, created_at DESC);

ALTER TABLE public.action_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_nonces_service_only ON public.action_nonces;
CREATE POLICY action_nonces_service_only ON public.action_nonces
FOR ALL USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, DELETE ON public.action_nonces TO service_role;

DO $$
BEGIN
  DELETE FROM public.action_nonces WHERE expires_at < now();
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END
$$;
