import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { v4 } from 'https://deno.land/std@0.201.0/uuid/mod.ts'

// Rotate service keys (admin only) - creates a new service_keys entry and returns a placeholder
serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    const { requireJwt } = await import('../lib/auth.ts')
    try { await requireJwt(req, ['admin']) } catch (err) { return new Response('unauthorized', { status: 401 }) }
    const id = crypto.randomUUID()
    await sb.from('service_keys').insert([{ id, name: 'rotated-'+id }])
    return new Response(JSON.stringify({ ok: true, key_id: id }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
