import { createClient } from "@supabase/supabase-js";

// CRITICAL: Load from environment variables, never hardcode
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ CRITICAL: Missing Supabase environment variables!");
  console.error(
    "Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env file",
  );
  throw new Error("Supabase configuration incomplete");
}

const SESSION_TOKEN_KEYS = ["chatapp-session-token", "zchat-session-token"];

async function authFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  try {
    for (const key of SESSION_TOKEN_KEYS) {
      const token = sessionStorage.getItem(key);
      if (token) {
        headers.set("x-session-token", token);
        break;
      }
    }
  } catch {
    // Ignore storage errors and continue without session header.
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      Accept: "application/json",
    },
    fetch: authFetch,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Minimal debug output only when DBG is enabled to avoid leaking tokens in logs
if (typeof window !== "undefined" && window.__CHAT_DEBUG__ === true) {
  console.log("[Supabase] Client initialized (DBG):", SUPABASE_URL);
}

/**
 * Security Notes:
 *
 * 1. ANON_KEY SECURITY:
 *    - This key is used for client-side operations
 *    - RLS (Row Level Security) policies prevent unauthorized access
 *    - Only expose ANON_KEY in frontend, NEVER SERVICE_ROLE_KEY
 *
 * 2. ROW LEVEL SECURITY:
 *    - All tables have RLS enabled
 *    - Users can only access their own data
 *    - Verified via auth.uid() in policies
 *
 * 3. SECRET ROTATION:
 *    - If ANON_KEY is compromised, rotate in Supabase dashboard
 *    - Update .env and redeploy immediately
 *
 * 4. ENV VARIABLES:
 *    - .env file is NEVER committed to git
 *    - .gitignore prevents accidental leaks
 *    - Share variables securely via .env.example template
 */
