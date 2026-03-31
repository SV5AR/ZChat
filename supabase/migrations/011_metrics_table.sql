create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  metric text not null,
  value jsonb,
  created_at timestamptz default now()
);
