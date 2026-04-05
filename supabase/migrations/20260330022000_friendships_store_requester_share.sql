ALTER TABLE IF EXISTS public.friendships
  ADD COLUMN IF NOT EXISTS requester_username_share text;
