import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: fetch-prekey-bundle
// Query params: ?id=<user_uuid>

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return new Response('missing id', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    // allow public read but validate optional token for rate limiting
    try {
      const { requireJwt } = await import('../lib/auth.ts')
      await requireJwt(req, ['user','guest'])
    } catch (_e) {
      // continue as anonymous
    }

    const { data, error } = await sb.from('users').select('prekey_bundle, public_identity_key').eq('id', id).single()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404 })
    try { await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ function_name: 'fetch-prekey-bundle', caller_id: id, event: { fetched: true } }) }) } catch (_e) {}
    return new Response(JSON.stringify({ ok: true, bundle: data }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
