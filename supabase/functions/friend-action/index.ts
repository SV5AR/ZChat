import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: friend-action
// Expects JSON: { requester_id, addressee_id, action } where action is 'request','accept','block','unfriend'

serve(async (req) => {
  try {
    const body = await req.json()
    const { requester_id, addressee_id, action } = body
    if (!requester_id || !addressee_id || !action) return new Response('missing fields', { status: 400 })

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

    if (action === 'request') {
      const { error } = await sb.from('friends').insert([{ requester: requester_id, addressee: addressee_id, status: 'pending' }])
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    if (action === 'accept') {
      const { error } = await sb.from('friends').update({ status: 'accepted' }).eq('requester', requester_id).eq('addressee', addressee_id)
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
      // TODO: also trigger notification / exchange encrypted username key via ratchet
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    if (action === 'block' || action === 'unfriend') {
      const { error } = await sb.from('friends').update({ status: action === 'block' ? 'blocked' : 'pending' }).or(`requester.eq.${requester_id},addressee.eq.${addressee_id}`)
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    return new Response('unknown action', { status: 400 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
