# Quick Start (ZChat)

This page is the fastest path to run ZChat locally and deploy schema/function changes safely.

## Live App

- Cloudflare Pages: `https://zchat-6uc.pages.dev/`
- Netlify: `https://zkchat.netlify.app`

## 1) Requirements

- Node.js 20+
- npm 10+
- Supabase project access
- Supabase CLI (recommended)

## 2) Install

```bash
npm install
```

## 3) Configure environment

```bash
cp .env.example .env
```

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 4) Apply database migrations

```bash
supabase db push
```

If you are not using local CLI flow, run SQL migration files from `supabase/migrations/` in your Supabase SQL Editor in timestamp order.

## 5) Deploy edge function (when changed)

```bash
supabase functions deploy auth-signin
```

## 6) Run the app

```bash
npm run dev
```

## 7) Verify production build

```bash
npm run build
```

## Quick sanity checks

- Login/bootstrap completes and app loads after init progress screen.
- Friends and chat list render correctly across all layouts.
- Telegram: fixed top section, fixed bottom nav, middle scroll only.
- Sidebar: compact/focus behavior works; main panel is dimmed/non-interactive while focused.
- Theme switching (palette/material/shape/layout) updates UI without forcing other dimensions.

## Troubleshooting

- **Missing environment values**: confirm `.env` exists and both required `VITE_*` variables are present.
- **Schema mismatch**: rerun migrations and verify `supabase/migrations/` are fully applied.
- **Function behavior mismatch**: redeploy `auth-signin` after edge changes.
