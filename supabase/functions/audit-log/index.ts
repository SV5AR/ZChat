import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge helper: log audit events (functions should call this internally)
serve(async (req) => {
  try {
    const body = await req.json()
    const { function_name, caller_id, event } = body
    if (!function_name) return new Response('missing function_name', { status: 400 })
    const sig = req.headers.get('x-internal-signature') || ''
    const { verifyBodySignature } = await import('../lib/signer.ts')
    const ok = await verifyBodySignature({ function_name, caller_id, event }, sig).catch(()=>false)
    if (!ok) return new Response('unauthorized', { status: 401 })
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)
    await sb.from('audit_logs').insert([{ function_name, caller_id, event, ip: null }])
    // route important metrics to alerting if thresholds exceeded
    try {
      const { data: settings } = await sb.from('app_settings').select('key,value')
      const map = (settings || []).reduce((acc, r) => { acc[r.key] = r.value; return acc }, {})
      const authFailThreshold = parseInt(map['AUTH_FAIL_THRESHOLD'] || '100')
      const rateLimitThreshold = parseInt(map['RATE_LIMIT_THRESHOLD'] || '50')
      const windowMin = parseInt(map['ALERT_WINDOW_MINUTES'] || '60')

      // if too many auth_fail metrics in the window -> alert
      const since = new Date(Date.now() - windowMin*60*1000).toISOString()
      const { data: authCount } = await sb.from('metrics').select('*').gte('created_at', since).eq('metric','auth_fail')
      if ((authCount || []).length >= authFailThreshold) {
        const { signBody } = await import('../lib/signer.ts')
        const payload = { alert: 'auth_fail_spike', count: (authCount || []).length }
        const sig = await signBody(payload)
        await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/alerting', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(payload) }).catch(()=>{})
      }
      // rate_limit events check
      const { data: rl } = await sb.from('metrics').select('*').gte('created_at', since).eq('metric','rate_limit')
      if ((rl || []).length >= rateLimitThreshold) {
        const { signBody } = await import('../lib/signer.ts')
        const payload = { alert: 'rate_limit_spike', count: (rl || []).length }
        const sig = await signBody(payload)
        await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/alerting', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(payload) }).catch(()=>{})
      }
    } catch (_e) {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
