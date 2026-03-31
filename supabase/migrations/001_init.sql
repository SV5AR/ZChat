-- Supabase migration: initial schema for ZChat
-- Creates users and messages tables. The client generates a random v4 UUID
-- and registers public_identity_key and prekey_bundle. Encrypted username
-- stored as ciphertext + iv + tag (bytea).

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  public_identity_key text not null,
  prekey_bundle jsonb,
  encrypted_username bytea,
  username_iv bytea,
  username_tag bytea,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid references users(id),
  ciphertext bytea not null,
  packet_size int not null,
  created_at timestamptz default now()
);

create index if not exists idx_messages_conversation on messages(conversation_id);
