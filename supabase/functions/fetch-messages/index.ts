import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Fetch messages for a conversation (requires JWT). Query param: ?conversation_id=
serve(async (req) => {
  try {
    const url = new URL(req.url)
    const conv = url.searchParams.get('conversation_id')
    if (!conv) return new Response('missing conversation_id', { status: 400 })
    const { requireJwt } = await import('../lib/auth.ts')
    try { await requireJwt(req, ['user']) } catch (err) { return new Response('unauthorized', { status: 401 }) }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    const { data } = await sb.from('messages').select('id,conversation_id,sender_id,ciphertext,packet_size,created_at').eq('conversation_id', conv)
    return new Response(JSON.stringify({ ok: true, messages: data }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
