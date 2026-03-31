import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts'

serve(async (req) => {
  try {
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return new Response('missing bearer', { status: 401 })
    const token = auth.split(' ')[1]
    const secret = Deno.env.get('SUPABASE_JWT_SECRET')
    if (!secret) return new Response('server misconfigured', { status: 500 })
    const payload = await verify(token, new TextEncoder().encode(secret), 'HS256')
    return new Response(JSON.stringify({ ok: true, payload }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 401 })
  }
})
