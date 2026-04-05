CREATE TABLE IF NOT EXISTS public.ratchet_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_key text NOT NULL,
  encrypted_state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_ratchet_per_conversation UNIQUE (user_id, conversation_key)
);

CREATE INDEX IF NOT EXISTS idx_ratchet_states_user
  ON public.ratchet_states(user_id);

CREATE INDEX IF NOT EXISTS idx_ratchet_states_conversation
  ON public.ratchet_states(user_id, conversation_key);

ALTER TABLE public.ratchet_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ratchet_states'
      AND policyname = 'users can read own ratchet states'
  ) THEN
    CREATE POLICY "users can read own ratchet states"
      ON public.ratchet_states
      FOR SELECT
      USING (user_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ratchet_states'
      AND policyname = 'users can insert own ratchet states'
  ) THEN
    CREATE POLICY "users can insert own ratchet states"
      ON public.ratchet_states
      FOR INSERT
      WITH CHECK (user_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ratchet_states'
      AND policyname = 'users can update own ratchet states'
  ) THEN
    CREATE POLICY "users can update own ratchet states"
      ON public.ratchet_states
      FOR UPDATE
      USING (user_id = public.custom_uid())
      WITH CHECK (user_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ratchet_states'
      AND policyname = 'users can delete own ratchet states'
  ) THEN
    CREATE POLICY "users can delete own ratchet states"
      ON public.ratchet_states
      FOR DELETE
      USING (user_id = public.custom_uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ratchet_states TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ratchet_states TO anon, authenticated;
