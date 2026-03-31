-- Create token revocations table and service_keys placeholder
create table if not exists token_revocations (
  jti text primary key,
  revoked_at timestamptz default now()
);

create table if not exists service_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Prevent modifications to audit_logs (immutable)
create or replace function prevent_audit_modify() returns trigger as $$
begin
  raise exception 'audit_logs is immutable';
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_audit_modify on audit_logs;
create trigger trg_prevent_audit_modify
  before update or delete on audit_logs
  for each row execute function prevent_audit_modify();
