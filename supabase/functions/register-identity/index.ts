// Use explicit remote imports compatible with Supabase bundler
import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts'

async function verifyAuth(req) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw new Error('missing bearer token')
  const token = auth.split(' ')[1]
  const secret = Deno.env.get('SUPABASE_JWT_SECRET')
  if (!secret) throw new Error('server misconfiguration: missing SUPABASE_JWT_SECRET')
  try {
    const payload = await verify(token, new TextEncoder().encode(secret), 'HS256')
    return payload
  } catch (err) {
    throw new Error('invalid token')
  }
}

// Edge Function: register-identity
// Expects JSON body: { id: string, public_identity_key: string, prekey_bundle: object }

serve(async (req) => {
  try {
    const body = await req.json()
    const { id, public_identity_key, prekey_bundle } = body
    if (!id || !public_identity_key) return new Response('missing fields', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    // Validate inputs conservatively
    if (typeof public_identity_key !== 'string' || public_identity_key.length > 4096) return new Response('invalid public key', { status: 400 })
    // require a valid JWT to avoid automated mass registration
    try {
      const { requireJwt } = await import('../lib/auth.ts')
      await requireJwt(req, ['user','admin'])
    } catch (err) {
      return new Response('unauthorized: ' + String(err.message), { status: 401 })
    }
    const { error } = await sb.from('users').upsert({ id, public_identity_key, prekey_bundle })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    // write audit log (signed request)
    try {
      const auditUrl = Deno.env.get('SUPABASE_FUNCTIONS_URL') || ''
      if (auditUrl) {
        const { signBody } = await import('../lib/signer.ts')
        const body = { function_name: 'register-identity', caller_id: id, event: { action: 'register' } }
        const sig = await signBody(body)
        await fetch(`${auditUrl}/audit-log`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(body) })
      }
    } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
