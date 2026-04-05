# Security Overview (ZChat)

This document summarizes the active security model used by ZChat today.

## Live App

- Cloudflare Pages: `https://zchat-6uc.pages.dev/`
- Netlify: `https://zkchat.netlify.app`

## Principles

- Minimize trust in backend execution paths.
- Enforce authorization and scope on every protected mutation.
- Prevent replay of sensitive actions.
- Keep user secrets out of source control and build artifacts.

## Enforcement layers

1. **Edge validation**
   - Protected actions are handled through edge logic (`auth-signin`) with session-bound validation.
   - Ownership/scope checks are enforced for chat, message, friendship, and block operations.

2. **Database policy layer**
   - RLS and schema constraints protect direct table access.
   - Migrations in `supabase/migrations/` are the source of truth.

3. **Nonce replay protection**
   - One-time action nonces are consumed server-side for sensitive mutations.

4. **Client crypto and key handling**
   - Message payloads are encrypted before storage/transit.
   - Ratchet state is used to maintain forward secrecy behavior in message flow.
   - Runtime key material is session-scoped and cleared on lock/logout paths.

## Data exposure caveat

As with most practical messaging systems, metadata such as timing/routing and delivery event patterns may still be observable to backend infrastructure.

## Operational checklist

- Keep `.env` local and never commit secrets.
- Do not store private keys or credentials in tracked files.
- Run migrations before shipping code that depends on new schema/policies.
- Re-deploy edge function when protected-action logic changes.
- Build locally (`npm run build`) before push if CI is unavailable.

## Security-sensitive areas in this repo

- `supabase/functions/auth-signin/`
- `supabase/migrations/`
- `src/utils/ratchetManager.js`
- `src/components/Chat.jsx`
- `src/App.jsx`

Any changes in these paths should be reviewed with extra care.
