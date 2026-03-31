-- Full ZChat schema: conversations, conversation_members, prekeys, friends, receipts, reactions
-- Enables cascade deletes and basic indexes

-- Conversations
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'peer', -- 'peer' or 'group'
  title text,
  created_at timestamptz default now()
);

create table if not exists conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (conversation_id, user_id)
);

-- Prekeys (one-time prekeys + signed prekey)
create table if not exists prekeys (
  user_id uuid references users(id) on delete cascade,
  prekey_id text not null,
  prekey_public text not null,
  created_at timestamptz default now(),
  used boolean default false,
  primary key (user_id, prekey_id)
);

-- Friends / Contacts
create table if not exists friends (
  id uuid primary key default gen_random_uuid(),
  requester uuid references users(id) on delete cascade,
  addressee uuid references users(id) on delete cascade,
  status text not null default 'pending', -- pending, accepted, blocked
  created_at timestamptz default now()
);

-- Message receipts, reactions, and edits stored as separate tables referencing messages
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  type text not null, -- delivered, read
  created_at timestamptz default now()
);

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz default now()
);

-- Message edits
create table if not exists message_edits (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  editor_id uuid references users(id) on delete cascade,
  edit_ciphertext bytea not null,
  packet_size int not null,
  created_at timestamptz default now()
);

-- Ensure messages have conversation_id index
create index if not exists idx_messages_conversation on messages(conversation_id);
