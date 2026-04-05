BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS public.messages_hidden CASCADE;
DROP TABLE IF EXISTS public.reactions CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.chat_rows CASCADE;
DROP TABLE IF EXISTS public.friendships CASCADE;
DROP TABLE IF EXISTS public.username_shares CASCADE;
DROP TABLE IF EXISTS public.ratchet_states CASCADE;
DROP TABLE IF EXISTS public.auth_challenges CASCADE;
DROP TABLE IF EXISTS public.auth_rate_limits CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP FUNCTION IF EXISTS public.get_pending_requests();
DROP FUNCTION IF EXISTS public.get_friends();
DROP FUNCTION IF EXISTS public.get_unread_counts();
DROP FUNCTION IF EXISTS public.mark_messages_read(text);

CREATE TABLE public.profiles (
  id text PRIMARY KEY,
  public_key text NOT NULL UNIQUE,
  encrypted_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_id_hex CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT profiles_public_key_hex CHECK (public_key ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text UNIQUE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_token_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_sessions_token_hash ON public.sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON public.sessions(expires_at);
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);

CREATE TABLE public.auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_hash text NOT NULL,
  server_key_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_challenge_hash_hex CHECK (challenge_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_auth_challenges_user ON public.auth_challenges(user_id);
CREATE INDEX idx_auth_challenges_expires ON public.auth_challenges(expires_at);
CREATE INDEX idx_auth_challenges_consumed ON public.auth_challenges(consumed_at);

CREATE TABLE public.auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_rate_limit_unique UNIQUE (key, endpoint, window_start)
);

CREATE INDEX idx_auth_rate_limits_lookup ON public.auth_rate_limits(key, endpoint, window_start);
CREATE INDEX idx_auth_rate_limits_blocked_until ON public.auth_rate_limits(blocked_until);

CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_low text GENERATED ALWAYS AS (LEAST(sender_id, receiver_id)) STORED,
  user_high text GENERATED ALWAYS AS (GREATEST(sender_id, receiver_id)) STORED,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
  encrypted_key_bundle text,
  requester_username_share text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (sender_id <> receiver_id),
  CONSTRAINT friendships_unique_pair UNIQUE (user_low, user_high)
);

CREATE INDEX idx_friendships_sender ON public.friendships(sender_id);
CREATE INDEX idx_friendships_receiver ON public.friendships(receiver_id);
CREATE INDEX idx_friendships_status ON public.friendships(status);
CREATE INDEX idx_friendships_updated_at ON public.friendships(updated_at DESC);

CREATE TABLE public.chat_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_rows_no_self CHECK (user_a <> user_b),
  CONSTRAINT chat_rows_user_order CHECK (user_a < user_b),
  CONSTRAINT chat_rows_unique_pair UNIQUE (user_a, user_b)
);

CREATE INDEX idx_chat_rows_user_a ON public.chat_rows(user_a);
CREATE INDEX idx_chat_rows_user_b ON public.chat_rows(user_b);
CREATE INDEX idx_chat_rows_updated_at ON public.chat_rows(updated_at DESC);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  encrypted_content text NOT NULL,
  nonce text NOT NULL,
  client_message_id text,
  reply_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  is_edited boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_no_self CHECK (sender_id <> receiver_id)
);

CREATE INDEX idx_messages_sender_receiver_created ON public.messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX idx_messages_receiver_sender_created ON public.messages(receiver_id, sender_id, created_at DESC);
CREATE INDEX idx_messages_receiver_unread ON public.messages(receiver_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_messages_reply_to ON public.messages(reply_to_message_id);
CREATE INDEX idx_messages_client_message_id ON public.messages(client_message_id);

CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  encrypted_emoji text NOT NULL,
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reactions_message_id ON public.reactions(message_id);
CREATE INDEX idx_reactions_message_user_created ON public.reactions(message_id, user_id, created_at DESC);

CREATE TABLE public.username_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_public_key text NOT NULL,
  encrypted_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_shares_no_self CHECK (owner_id <> recipient_id),
  CONSTRAINT username_shares_owner_public_key_hex CHECK (owner_public_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT username_shares_owner_recipient_unique UNIQUE (owner_id, recipient_id)
);

CREATE INDEX idx_username_shares_recipient ON public.username_shares(recipient_id, updated_at DESC);

CREATE TABLE public.messages_hidden (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_hidden_message_user_unique UNIQUE (message_id, user_id)
);

CREATE INDEX idx_messages_hidden_user ON public.messages_hidden(user_id, hidden_at DESC);
CREATE INDEX idx_messages_hidden_message ON public.messages_hidden(message_id);

CREATE TABLE public.ratchet_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_key text NOT NULL,
  encrypted_state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ratchet_states_user_conversation_unique UNIQUE (user_id, conversation_key)
);

CREATE INDEX idx_ratchet_states_user ON public.ratchet_states(user_id);
CREATE INDEX idx_ratchet_states_user_conversation ON public.ratchet_states(user_id, conversation_key);

CREATE OR REPLACE FUNCTION public.bump_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE TRIGGER trg_friendships_updated_at
BEFORE UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE TRIGGER trg_chat_rows_updated_at
BEFORE UPDATE ON public.chat_rows
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE TRIGGER trg_username_shares_updated_at
BEFORE UPDATE ON public.username_shares
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE TRIGGER trg_auth_rate_limits_updated_at
BEFORE UPDATE ON public.auth_rate_limits
FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

CREATE OR REPLACE FUNCTION public.custom_uid()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (
      SELECT s.user_id
      FROM public.sessions s
      WHERE s.expires_at > now()
        AND s.token_hash = encode(
          extensions.digest(
            convert_to(
              COALESCE(
                (current_setting('request.headers', true)::json ->> 'x-session-token'),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      ORDER BY s.expires_at DESC
      LIMIT 1
    ),
    ''
  );
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.username_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages_hidden ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratchet_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_authd ON public.profiles
FOR SELECT USING (public.custom_uid() <> '');

CREATE POLICY profiles_insert_self ON public.profiles
FOR INSERT WITH CHECK (id = public.custom_uid());

CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE USING (id = public.custom_uid())
WITH CHECK (id = public.custom_uid());

CREATE POLICY profiles_delete_self ON public.profiles
FOR DELETE USING (id = public.custom_uid());

CREATE POLICY friendships_select_participant ON public.friendships
FOR SELECT USING (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY friendships_insert_sender ON public.friendships
FOR INSERT WITH CHECK (
  sender_id = public.custom_uid()
  AND sender_id <> receiver_id
);

CREATE POLICY friendships_update_participant ON public.friendships
FOR UPDATE USING (public.custom_uid() IN (sender_id, receiver_id))
WITH CHECK (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY friendships_delete_participant ON public.friendships
FOR DELETE USING (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY chat_rows_select_participant ON public.chat_rows
FOR SELECT USING (public.custom_uid() IN (user_a, user_b));

CREATE POLICY chat_rows_insert_creator ON public.chat_rows
FOR INSERT WITH CHECK (
  created_by = public.custom_uid()
  AND public.custom_uid() IN (user_a, user_b)
);

CREATE POLICY chat_rows_delete_participant ON public.chat_rows
FOR DELETE USING (public.custom_uid() IN (user_a, user_b));

CREATE POLICY messages_select_participant ON public.messages
FOR SELECT USING (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY messages_insert_sender ON public.messages
FOR INSERT WITH CHECK (
  sender_id = public.custom_uid()
  AND EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.sender_id = messages.sender_id AND f.receiver_id = messages.receiver_id)
        OR (f.sender_id = messages.receiver_id AND f.receiver_id = messages.sender_id)
      )
  )
);

CREATE POLICY messages_update_participant ON public.messages
FOR UPDATE USING (public.custom_uid() IN (sender_id, receiver_id))
WITH CHECK (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY messages_delete_participant ON public.messages
FOR DELETE USING (public.custom_uid() IN (sender_id, receiver_id));

CREATE POLICY reactions_select_message_participant ON public.reactions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = reactions.message_id
      AND public.custom_uid() IN (m.sender_id, m.receiver_id)
  )
);

CREATE POLICY reactions_insert_self ON public.reactions
FOR INSERT WITH CHECK (
  user_id = public.custom_uid()
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.id = reactions.message_id
      AND public.custom_uid() IN (m.sender_id, m.receiver_id)
  )
);

CREATE POLICY reactions_delete_self ON public.reactions
FOR DELETE USING (user_id = public.custom_uid());

CREATE POLICY username_shares_select_owner_or_recipient ON public.username_shares
FOR SELECT USING (public.custom_uid() IN (owner_id, recipient_id));

CREATE POLICY username_shares_insert_owner ON public.username_shares
FOR INSERT WITH CHECK (
  owner_id = public.custom_uid()
  AND EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.sender_id = username_shares.owner_id AND f.receiver_id = username_shares.recipient_id)
        OR (f.sender_id = username_shares.recipient_id AND f.receiver_id = username_shares.owner_id)
      )
  )
);

CREATE POLICY username_shares_update_owner ON public.username_shares
FOR UPDATE USING (owner_id = public.custom_uid())
WITH CHECK (owner_id = public.custom_uid());

CREATE POLICY username_shares_delete_owner ON public.username_shares
FOR DELETE USING (owner_id = public.custom_uid());

CREATE POLICY messages_hidden_select_owner ON public.messages_hidden
FOR SELECT USING (user_id = public.custom_uid());

CREATE POLICY messages_hidden_insert_owner ON public.messages_hidden
FOR INSERT WITH CHECK (user_id = public.custom_uid());

CREATE POLICY messages_hidden_delete_owner ON public.messages_hidden
FOR DELETE USING (user_id = public.custom_uid());

CREATE POLICY ratchet_states_select_owner ON public.ratchet_states
FOR SELECT USING (user_id = public.custom_uid());

CREATE POLICY ratchet_states_insert_owner ON public.ratchet_states
FOR INSERT WITH CHECK (user_id = public.custom_uid());

CREATE POLICY ratchet_states_update_owner ON public.ratchet_states
FOR UPDATE USING (user_id = public.custom_uid())
WITH CHECK (user_id = public.custom_uid());

CREATE POLICY ratchet_states_delete_owner ON public.ratchet_states
FOR DELETE USING (user_id = public.custom_uid());

CREATE POLICY sessions_service_only ON public.sessions
FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY auth_challenges_service_only ON public.auth_challenges
FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY auth_rate_limits_service_only ON public.auth_rate_limits
FOR ALL USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_rows TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.reactions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.username_shares TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages_hidden TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ratchet_states TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_rate_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_rows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.username_shares TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages_hidden TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ratchet_states TO service_role;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rows;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reactions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.username_shares;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages_hidden;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ratchet_states;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE public.friendships REPLICA IDENTITY FULL;
ALTER TABLE public.chat_rows REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.reactions REPLICA IDENTITY FULL;
ALTER TABLE public.username_shares REPLICA IDENTITY FULL;
ALTER TABLE public.messages_hidden REPLICA IDENTITY FULL;
ALTER TABLE public.ratchet_states REPLICA IDENTITY FULL;

COMMIT;
