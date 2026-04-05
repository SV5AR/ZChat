CREATE TABLE IF NOT EXISTS public.messages_hidden (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_hidden_message_user_unique UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_hidden_user
  ON public.messages_hidden(user_id, hidden_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_hidden_message
  ON public.messages_hidden(message_id);

ALTER TABLE public.messages_hidden ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages_hidden'
      AND policyname = 'users can read own hidden messages'
  ) THEN
    CREATE POLICY "users can read own hidden messages"
      ON public.messages_hidden
      FOR SELECT
      USING (user_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages_hidden'
      AND policyname = 'users can insert own hidden messages'
  ) THEN
    CREATE POLICY "users can insert own hidden messages"
      ON public.messages_hidden
      FOR INSERT
      WITH CHECK (user_id = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages_hidden'
      AND policyname = 'users can delete own hidden messages'
  ) THEN
    CREATE POLICY "users can delete own hidden messages"
      ON public.messages_hidden
      FOR DELETE
      USING (user_id = public.custom_uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages_hidden TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages_hidden TO anon, authenticated;
