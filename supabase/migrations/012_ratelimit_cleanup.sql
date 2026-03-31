-- Cleanup old rate limit windows (entries older than 1 day)
create or replace function cleanup_rate_limits() returns void as $func$
begin
  delete from rate_limits where window_start < now() - interval '1 day';
end;
$func$ language plpgsql;
