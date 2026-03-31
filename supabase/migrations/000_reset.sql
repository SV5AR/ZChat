-- Drop all ZChat-related tables and extensions to reset project to default state
-- Run this with: supabase db query --file=supabase/migrations/000_reset.sql

-- Revoke extensions and drop tables if they exist
drop table if exists messages cascade;
drop table if exists users cascade;

-- Optionally remove pgcrypto extension (leave if used by other projects)
-- drop extension if exists pgcrypto;

-- You can run the following migration after this to recreate the schema:
-- supabase db query --file=supabase/migrations/001_init.sql
