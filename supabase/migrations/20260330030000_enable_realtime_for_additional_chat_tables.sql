DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.username_shares;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages_hidden;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ratchet_states;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;
END $$;

ALTER TABLE IF EXISTS public.username_shares REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.messages_hidden REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.ratchet_states REPLICA IDENTITY FULL;
