import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: ingest-message
// Expects JSON body: { conversation_id, sender_id, ciphertext_base64, packet_size }

serve(async (req) => {
  try {
    const body = await req.json()
    const { conversation_id, sender_id, ciphertext_base64, packet_size } = body
    if (!conversation_id || !sender_id || !ciphertext_base64) return new Response('missing fields', { status: 400 })

    // Basic token check to ensure requests are authenticated
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return new Response('missing bearer', { status: 401 })
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    // verify jwt and require 'user' role
    try {
      const { requireJwt } = await import('../lib/auth.ts')
      await requireJwt(req, ['user'])
    } catch (err) {
      return new Response('unauthorized: ' + String(err.message), { status: 401 })
    }
    // enforce rate limits: simple sliding window per sender
    try {
      const now = new Date().toISOString()
      const { data } = await sb.from('rate_limits').select('*').eq('user_id', sender_id).single()
      if (data) {
        const windowStart = new Date(data.window_start)
        const elapsed = (Date.now() - windowStart.getTime()) / 1000
        if (elapsed < 60 && data.count > 120) {
          try { await sb.from('metrics').insert([{ metric: 'rate_limit', value: { user: sender_id, window_start: data.window_start } }]) } catch (_e) {}
          return new Response('rate limit', { status: 429 })
        }
        if (elapsed >= 60) {
          await sb.from('rate_limits').update({ window_start: now, count: 1 }).eq('user_id', sender_id)
        } else {
          await sb.from('rate_limits').update({ count: data.count + 1 }).eq('user_id', sender_id)
        }
      } else {
        await sb.from('rate_limits').insert([{ user_id: sender_id, window_start: now, count: 1 }])
      }
    } catch (_e) { }

    const ciphertext = Uint8Array.from(atob(ciphertext_base64), c => c.charCodeAt(0))
    // enforce packet size (pad or reject)
    try {
      const { data: setting } = await sb.from('app_settings').select('value').eq('key', 'PACKET_SIZE').single()
      const packetSize = setting ? parseInt(setting.value) : 4096
      if (ciphertext.length !== packetSize) return new Response('invalid packet size', { status: 400 })
    } catch (_e) {}
    const { error } = await sb.from('messages').insert([{ conversation_id, sender_id, ciphertext, packet_size }])
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    // audit log (signed)
    try {
      const { signBody } = await import('../lib/signer.ts')
      const body = { function_name: 'ingest-message', caller_id: sender_id, event: { conversation_id } }
      const sig = await signBody(body)
      await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(body) })
      // forward high-rate events to alerting
      await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/alerting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alert: 'ingest', user: sender_id, conversation_id }) }).catch(()=>{})
    } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
