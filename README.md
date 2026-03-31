# Bitcoin Messaging App — Scaffold

This workspace contains a minimal scaffold for the zero-knowledge, privacy-first messaging app described in `.ai/instruction.md`.

Quick start:

1. Install dependencies:

```bash
cd "/home/sv5ar/Documents/BITCOIN MESSAGING APP"
npm install
```

2. Run dev server:

```bash
npm run dev
```

Supabase edge function

- Use the Supabase CLI to deploy and test the `supabase/edge-functions/relay` function.

Supabase setup:

- Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Apply schema using Supabase SQL or `supabase db push`.


Notes
- This is a starting scaffold: implement Argon2, X3DH, Double Ratchet, SQLCipher integration, and Supabase schemas next.
