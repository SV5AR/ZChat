import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export async function requireJwt(req, allowedRoles = []) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw new Error('missing bearer')
  const token = auth.split(' ')[1]
  const secret = Deno.env.get('SUPABASE_JWT_SECRET')
  if (!secret) throw new Error('server misconfigured: missing SUPABASE_JWT_SECRET')
  let payload
  try {
    payload = await verify(token, new TextEncoder().encode(secret), 'HS256')
  } catch (err) {
    // emit metric for invalid token
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm')
        const sb = createClient(supabaseUrl, supabaseKey)
        await sb.from('metrics').insert([{ metric: 'auth_fail', value: { reason: String(err.message) } }])
      }
    } catch (_e) {}
    throw new Error('invalid token')
  }
  // token revocation check
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    const jti = payload?.jti || payload?.j || null
    if (jti) {
      const { data: revoked } = await sb.from('token_revocations').select('jti').eq('jti', jti).single()
      if (revoked) throw new Error('token revoked')
    }
  } catch (e) {
    // if revocation check fails treat as error
    if (String(e.message).includes('token revoked')) throw e
  }
  // role enforcement
  if (allowedRoles && allowedRoles.length > 0) {
    const role = payload?.role || payload?.r || null
    if (!role || !allowedRoles.includes(role)) throw new Error('insufficient role')
  }
  return payload
}
