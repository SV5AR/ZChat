import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Admin-only: rotate internal HMAC key used for function-to-function signing.
// WARNING: This returns the raw key material in the response — store securely and rotate env vars accordingly.

serve(async (req) => {
  try {
    const { requireJwt } = await import('../lib/auth.ts')
    try { await requireJwt(req, ['admin']) } catch (err) { return new Response('unauthorized', { status: 401 }) }

    // generate 32 bytes random key
    const key = crypto.getRandomValues(new Uint8Array(32))
    const keyB64 = btoa(String.fromCharCode(...key))

    // record key id metadata in service_keys
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    const id = crypto.randomUUID()
    await sb.from('service_keys').insert([{ id, name: 'internal-hmac-' + id }])

    return new Response(JSON.stringify({ ok: true, key: keyB64, key_id: id }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
