-- Supabase schema for blind relay storage (encrypted blobs only)

create table if not exists identities (
  id uuid primary key default gen_random_uuid(),
  uuid text not null unique,
  public_x25519 text not null,
  public_ed25519 text not null,
  encrypted_username bytea,
  created_at timestamptz default now()
);

create table if not exists blobs (
  id uuid primary key default gen_random_uuid(),
  identity_uuid text not null,
  kind text not null,
  payload bytea not null,
  created_at timestamptz default now()
);

create index if not exists blobs_identity_idx on blobs (identity_uuid);

-- Table for relayed packets (encrypted)
create table if not exists packets (
  id uuid primary key default gen_random_uuid(),
  from_uuid text,
  to_uuid text,
  envelope bytea not null,
  created_at timestamptz default now()
);
