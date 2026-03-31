import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: rotate-prekeys
// Expects JSON: { user_id, prekeys: [{prekey_id, prekey_public}, ...] }

serve(async (req) => {
  try {
    const body = await req.json()
    const { user_id, prekeys } = body
    if (!user_id || !Array.isArray(prekeys)) return new Response('missing fields', { status: 400 })

    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return new Response('missing bearer', { status: 401 })
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    try {
      const { requireJwt } = await import('../lib/auth.ts')
      await requireJwt(req, ['user'])
    } catch (err) {
      return new Response('unauthorized: ' + String(err.message), { status: 401 })
    }

    // Insert prekeys in a transaction
    for (const pk of prekeys) {
      await sb.from('prekeys').upsert({ user_id, prekey_id: pk.prekey_id, prekey_public: pk.prekey_public })
    }
    try { await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ function_name: 'rotate-prekeys', caller_id: user_id, event: { count: prekeys.length } }) }) } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
