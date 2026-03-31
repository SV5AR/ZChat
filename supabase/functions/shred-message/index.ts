// Use explicit remote imports compatible with Supabase bundler
import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import nacl from 'https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/+esm'

function b64ToU8(s){ try { return Uint8Array.from(atob(s), c=>c.charCodeAt(0)) } catch(e) { return null } }
function hexToU8(s){ if (s.startsWith('0x')) s = s.slice(2); const pairs = s.match(/.{1,2}/g)||[]; return Uint8Array.from(pairs.map(p=>parseInt(p,16))) }
function verifySignature(pubKeyStored, message, sigB64){
  if (!pubKeyStored) return false
  let pub = b64ToU8(pubKeyStored)
  if (!pub) {
    try { pub = hexToU8(pubKeyStored) } catch(e){ pub = null }
  }
  if (!pub) return false
  const sig = b64ToU8(sigB64)
  if (!sig) return false
  try {
    const msg = new TextEncoder().encode(message)
    return nacl.sign.detached.verify(msg, sig, pub)
  } catch(e){ return false }
}

// Edge Function: shred-message
// Expects JSON body: { message_id: string }

serve(async (req) => {
  try {
    const body = await req.json()
    const { message_id } = body
    if (!message_id) return new Response('missing message_id', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    try {
      const { requireJwt } = await import('../lib/auth.ts')
      await requireJwt(req, ['user'])
    } catch (err) {
      return new Response('unauthorized: ' + String(err.message), { status: 401 })
    }

    // Delete the message row and any dependent metadata
    // Verify signature: require { signer_id, signature }
    const { signer_id, signature } = body
    if (!signer_id || !signature) return new Response('missing signature', { status: 401 })
    // fetch signer's public key
    const { data: user, error: userErr } = await sb.from('users').select('public_identity_key').eq('id', signer_id).single()
    if (userErr || !user) return new Response('unknown signer', { status: 404 })
    const ok = await verifySignature(user.public_identity_key, JSON.stringify({ action: 'shred-message', message_id }), signature)
    if (!ok) return new Response('invalid signature', { status: 401 })

    const { error } = await sb.from('messages').delete().eq('id', message_id)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    try {
      const { signBody } = await import('../lib/signer.ts')
      const bodySig = { function_name: 'shred-message', caller_id: signer_id, event: { message_id } }
      const sig2 = await signBody(bodySig)
      await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig2 }, body: JSON.stringify(bodySig) })
    } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
