-- Security hardening migrations

-- Audit log for function calls (no sensitive content stored)
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  function_name text not null,
  caller_id uuid,
  event jsonb,
  ip inet,
  created_at timestamptz default now()
);

-- Settings table for operational constants (packet size, etc.)
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Default packet size (bytes). Clients MUST send packets that match this size.
insert into app_settings (key, value) values ('PACKET_SIZE', '4096') on conflict (key) do nothing;

-- Restrict direct client access: enable RLS on sensitive tables
alter table users enable row level security;
alter table messages enable row level security;
alter table prekeys enable row level security;

-- Policies: by default deny all access; functions use service_role key for privileged ops
do $$ begin
  if not exists (select 1 from pg_policies p where p.policyname = 'users_deny_all' and p.tablename = 'users') then
    execute 'create policy users_deny_all on users for all using (false) with check (false)';
  end if;
  if not exists (select 1 from pg_policies p where p.policyname = 'messages_deny_all' and p.tablename = 'messages') then
    execute 'create policy messages_deny_all on messages for all using (false) with check (false)';
  end if;
  if not exists (select 1 from pg_policies p where p.policyname = 'prekeys_deny_all' and p.tablename = 'prekeys') then
    execute 'create policy prekeys_deny_all on prekeys for all using (false) with check (false)';
  end if;
end $$;
