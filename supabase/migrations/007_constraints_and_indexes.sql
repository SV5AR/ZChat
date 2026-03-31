-- Add constraints and useful indexes to enforce integrity and performance

alter table users add constraint users_public_key_not_null check (public_identity_key is not null);

alter table messages add constraint messages_packet_size_positive check (packet_size > 0);

create index if not exists idx_messages_created_at on messages(created_at);
create index if not exists idx_auditlogs_created_at on audit_logs(created_at);
