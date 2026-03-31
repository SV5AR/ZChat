-- Rate limiting table for per-user action windows
create table if not exists rate_limits (
  user_id uuid primary key,
  window_start timestamptz not null,
  count int not null default 0
);
