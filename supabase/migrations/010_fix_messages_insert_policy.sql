-- Replace messages insert policy with a canonical policy referencing row columns
-- Drop old policy if exists
drop policy if exists messages_insert_for_member on messages;

create policy messages_insert_for_member on messages
  for insert with check (
    sender_id = auth.uid()::uuid
    and exists (
      select 1 from conversation_members cm
      where cm.conversation_id = conversation_id
        and cm.user_id = auth.uid()::uuid
    )
  );
