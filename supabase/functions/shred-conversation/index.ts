import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: shred-conversation
// Expects JSON body: { conversation_id }

serve(async (req) => {
  try {
    const body = await req.json()
    const { conversation_id } = body
    if (!conversation_id) return new Response('missing conversation_id', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // delete conversations will cascade to messages and related metadata
    const { error } = await sb.from('conversations').delete().eq('id', conversation_id)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    try { await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ function_name: 'shred-conversation', caller_id: null, event: { conversation_id } }) }) } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
