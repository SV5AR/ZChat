CREATE TABLE IF NOT EXISTS public.chat_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_rows_user_order CHECK (user_a < user_b),
  CONSTRAINT chat_rows_unique_pair UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_chat_rows_user_a ON public.chat_rows(user_a);
CREATE INDEX IF NOT EXISTS idx_chat_rows_user_b ON public.chat_rows(user_b);

ALTER TABLE public.chat_rows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_rows'
      AND policyname = 'users can read own chat rows'
  ) THEN
    CREATE POLICY "users can read own chat rows"
      ON public.chat_rows
      FOR SELECT
      USING (user_a = public.custom_uid() OR user_b = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_rows'
      AND policyname = 'users can insert own chat rows'
  ) THEN
    CREATE POLICY "users can insert own chat rows"
      ON public.chat_rows
      FOR INSERT
      WITH CHECK (created_by = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_rows'
      AND policyname = 'users can delete own chat rows'
  ) THEN
    CREATE POLICY "users can delete own chat rows"
      ON public.chat_rows
      FOR DELETE
      USING (user_a = public.custom_uid() OR user_b = public.custom_uid());
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rows;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;
END $$;

ALTER TABLE IF EXISTS public.chat_rows REPLICA IDENTITY FULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_rows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_rows TO anon, authenticated;
