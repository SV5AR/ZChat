ALTER TABLE IF EXISTS public.reactions
  DROP CONSTRAINT IF EXISTS unique_reaction;

CREATE INDEX IF NOT EXISTS idx_reactions_message_user
  ON public.reactions(message_id, user_id, created_at DESC);
