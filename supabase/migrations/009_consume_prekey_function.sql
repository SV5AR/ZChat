-- Create a DB function to atomically select and mark a one-time prekey as used
create or replace function consume_prekey_for_user(uid uuid)
returns table(prekey_id text, prekey_public text) as $$
declare
  r record;
begin
  -- select a single unused prekey row and lock it to prevent races
  select prekey_id, prekey_public into r
  from prekeys
  where user_id = uid and used = false
  for update skip locked
  limit 1;

  if not found then
    return; -- no rows -> empty set
  end if;

  -- mark it used
  update prekeys set used = true where user_id = uid and prekey_id = r.prekey_id;

  prekey_id := r.prekey_id;
  prekey_public := r.prekey_public;
  return next;
end;
$$ language plpgsql;
