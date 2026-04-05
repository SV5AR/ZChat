CREATE TABLE IF NOT EXISTS public.username_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_public_key text NOT NULL,
  encrypted_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_shares_owner_recipient_unique UNIQUE (owner_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_username_shares_recipient
  ON public.username_shares(recipient_id, updated_at DESC);

ALTER TABLE public.username_shares ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'username_shares'
      AND policyname = 'users can read incoming username shares'
  ) THEN
    CREATE POLICY "users can read incoming username shares"
      ON public.username_shares
      FOR SELECT
      USING (recipient_id = public.custom_uid() OR owner_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'username_shares'
      AND policyname = 'users can upsert outgoing username shares'
  ) THEN
    CREATE POLICY "users can upsert outgoing username shares"
      ON public.username_shares
      FOR INSERT
      WITH CHECK (owner_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'username_shares'
      AND policyname = 'users can update outgoing username shares'
  ) THEN
    CREATE POLICY "users can update outgoing username shares"
      ON public.username_shares
      FOR UPDATE
      USING (owner_id = public.custom_uid())
      WITH CHECK (owner_id = public.custom_uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.username_shares TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.username_shares TO anon, authenticated;
