import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Simple alerting function: forwards alerts to configured webhook (Slack/PagerDuty)
serve(async (req) => {
  try {
    const body = await req.json()
    const webhook = Deno.env.get('ALERT_WEBHOOK_URL')
    if (!webhook) return new Response('no webhook configured', { status: 500 })
    // sign payload
    try { const { signBody } = await import('../lib/signer.ts'); const sig = await signBody(body); await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(body) }) } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500 }) }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
