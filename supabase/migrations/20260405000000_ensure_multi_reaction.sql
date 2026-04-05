-- Ensure the reactions table allows multiple reactions per user per message.
-- This explicitly drops any accidental unique constraint and adds a check.

-- Drop any stale unique constraint (safe if it doesn't exist)
ALTER TABLE IF EXISTS public.reactions
  DROP CONSTRAINT IF EXISTS unique_reaction;

-- Add an explicit index for efficient lookups (already exists in some migrations, safe to recreate)
CREATE INDEX IF NOT EXISTS idx_reactions_message_user_emoji
  ON public.reactions(message_id, user_id, encrypted_emoji);

-- Verify: ensure REPLICA IDENTITY is FULL for realtime DELETE events to include full old data
ALTER TABLE public.reactions REPLICA IDENTITY FULL;
