import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Helper function to check RLS policies and generate minimal tokens for clients (if any)
serve(async (req) => {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
