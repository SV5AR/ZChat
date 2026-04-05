# ZChat

ZChat is a security-focused, friend-based messaging application built with React + Supabase. It combines encrypted direct messaging, ratchet-forward secrecy, strict server-side mutation validation, resilient realtime sync, and a multi-layout UI system (Default, Telegram, Discord/Sidebar) with rich theme/material customization.

## Live App

- Cloudflare Pages: `https://zchat-6uc.pages.dev/`
- Netlify: `https://zkchat.netlify.app`

## Why ZChat

Most chat apps are either visually polished but weakly opinionated on data/security rules, or secure but rough around UX consistency. ZChat is designed to keep both sides strong:

- **Predictable data rules** around friendship, chat existence, and cleanup.
- **Security hardening** at both edge and database layers.
- **Realtime reliability** with fallback reconciliation paths.
- **Distinct visual identity** through palette + material + shape + layout combinations.

## Core Product Capabilities

- End-to-end style encrypted payload flow with ratchet message progression.
- Friend request system (received/sent/friends/blocked states) with strict action gating.
- Conversation lifecycle driven by `chat_rows` (source of truth), not friendship alone.
- Deterministic read receipts and message status rendering.
- Reactions, edits, chat/message delete/hide operations.
- Device safeguards: app lock, PIN vault, biometric guard, remember-me controls.
- Theme engine with independent palette, material, shape, and layout selection.

## UX System

### Layout modes

- **Default (modal):** classic app layout with overlay sections.
- **Telegram:** fixed top section header, fixed bottom navigation, center content scroll.
- **Discord/Sidebar:** compact rail, focus-expand behavior, dimmed main panel while focused.

### Theme model

The visual system is composed from four independent dimensions:

1. **Palette** (color identity)
2. **Material** (`solid`, `glass`, `neumorphism`, `m3`)
3. **Shape** (`sharp`, `rounded`, `soft`, `pill`)
4. **Layout** (`modal`, `telegram`, `sidebar`)

This allows the same palette to feel very different across materials and layouts.

### Motion model

Motion is tokenized and adaptive:

- Material-specific timing/easing/hover behavior
- Layout-specific interaction pacing
- Shared transitions for controls, tabs, menus, sheets, and overlays

## Conversation Lifecycle Rules

ZChat enforces explicit chat existence and visibility rules:

- `chat_rows` is the canonical source for conversation existence.
- Accepting friendship alone does **not** create a conversation.
- Conversation appears only after explicit start/ensure chat action.
- Unfriend/block/delete flows cascade related cleanup to prevent stale visibility.

## Messaging Reliability Model

- Realtime channels deliver message and social graph events.
- Incoming message handling is queue/reconciliation based to reduce decrypt races.
- Background refresh acts as a safety net when realtime events are missed.
- Read receipt logic is deterministic even when receiver already has the chat open.

## Security Model (High Level)

- **Session-bound mutations:** sensitive actions are validated server-side.
- **Nonce replay protection:** one-time action nonces are consumed by protected endpoints.
- **Scoped authorization checks:** message/friendship/block/chat operations verify ownership and relationship context.
- **Encrypted content at rest:** message body storage uses ciphertext payloads.
- **RLS + edge enforcement:** database policies and edge validation both participate.

Note: routing and delivery metadata (timing/event patterns) may still be observable to backend infrastructure, as with most practical messaging systems.

## Technical Stack

- **Frontend:** React, Vite
- **Backend:** Supabase (Postgres, Realtime, Edge Functions)
- **Crypto/security helpers:** Web Crypto APIs + secure storage/session helpers
- **Primary edge gateway:** `supabase/functions/auth-signin`

## Repository Guide

- `src/App.jsx` - app shell, auth bootstrap, layout orchestration, global realtime wiring, badges.
- `src/components/Chat.jsx` - message pipeline, receipt/status logic, reactions, popup behavior.
- `src/components/Friends.jsx` - social graph workflows (requests/friends/blocked).
- `src/components/Settings.jsx` - key/security and preference controls.
- `src/components/ThemePicker.jsx` - palette/material/shape/layout selection UI.
- `src/context/ThemeContext.jsx` - theme composition and CSS variable/material binding.
- `src/lib/schemaApi.js` - API/data access abstraction.
- `src/utils/ratchetManager.js` - ratchet state, encryption/decryption flow controls.
- `supabase/migrations/` - schema and policy evolution.
- `supabase/functions/auth-signin/` - edge mutation validation and auth-sensitive actions.

## Local Development

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

3. Apply migrations

```bash
supabase db push
```

4. Deploy edge function when changed

```bash
supabase functions deploy auth-signin
```

5. Start dev server

```bash
npm run dev
```

6. Validate production build

```bash
npm run build
```

## Manual Verification Checklist

Before pushing changes, quickly verify:

- Conversation list and chat opening across all 3 layouts.
- Read receipts and message status ordering.
- Realtime behavior after tab visibility changes.
- Theme combinations (palette x material x shape x layout) and active-state styling.
- Telegram fixed top/bottom behavior with middle scroll.
- Sidebar compact/focus transitions and interaction lock on main panel while focused.

## Operational Notes

- Never commit secrets (`.env`, exported credentials, private key artifacts).
- Prefer small, auditable commits for security-sensitive changes.
- Prefer CI builds; if unavailable, run `npm run build` locally before pushing.
- Do not commit `dist/` unless your deployment target explicitly requires it.

## License

This project is licensed under the MIT License. See `LICENSE.md`.
