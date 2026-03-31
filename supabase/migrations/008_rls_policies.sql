-- RLS policies to allow conversation members to access messages and membership info

-- Allow users to see their own conversation membership
alter table conversation_members enable row level security;
create policy conversation_members_select_member on conversation_members
  for select using (auth.uid()::uuid = user_id);

-- Allow members to insert themselves into conversation_members (join)
create policy conversation_members_insert_self on conversation_members
  for insert with check (auth.uid()::uuid = user_id);

-- Messages: allow members of a conversation to select messages
alter table messages enable row level security;
create policy messages_select_for_member on messages
  for select using (exists (select 1 from conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()::uuid));

-- Messages: allow authenticated users to insert messages only if sender_id == auth.uid and they are members
create policy messages_insert_for_member on messages
  for insert with check (sender_id = auth.uid()::uuid and exists (select 1 from conversation_members cm where cm.conversation_id = (SELECT conversation_id FROM messages WHERE id IS NULL) and cm.user_id = auth.uid()::uuid));
