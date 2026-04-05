# Supabase Setup (ZChat)

This document covers the minimum Supabase setup required for ZChat.

## Live App

- Cloudflare Pages: `https://zchat-6uc.pages.dev/`
- Netlify: `https://zkchat.netlify.app`

## Create project

1. Create a Supabase project.
2. Copy your project URL and anon key.
3. Add them to `.env` as:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Apply schema

Preferred:

```bash
supabase db push
```

Alternative:

- Run all SQL files in `supabase/migrations/` in timestamp order via SQL Editor.

## Deploy edge function

Deploy `auth-signin` when function code changes:

```bash
supabase functions deploy auth-signin
```

## Realtime notes

ZChat depends on realtime updates for:

- `friendships`
- `messages`
- `chat_rows`
- `username_shares`

Ensure migrations completed successfully so required tables, policies, and realtime behavior are available.

## Verification

After setup:

1. Run `npm run dev`
2. Sign in with two accounts
3. Send/receive messages and verify chats appear from `chat_rows`
4. Confirm friend request badges and read receipts update without refresh
