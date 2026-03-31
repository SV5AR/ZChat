-- Retention policy for audit_logs (archive older than 1 year into audit_logs_archive)

-- Create archive table if missing
create table if not exists audit_logs_archive ( like audit_logs including all );

-- Create archival function
create or replace function archive_old_audit_logs() returns void as $func$
begin
  insert into audit_logs_archive select * from audit_logs where created_at < now() - interval '1 year';
  delete from audit_logs where created_at < now() - interval '1 year';
end;
$func$ language plpgsql;

-- Schedule: call this function from cron or an external scheduler
