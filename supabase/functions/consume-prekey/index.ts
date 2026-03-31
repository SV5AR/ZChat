import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Edge Function: consume-prekey
// Expects JSON body: { target_user_id }
// Returns: { ok:true, bundle: { public_identity_key, signed_prekey, one_time_prekey } }

serve(async (req) => {
  try {
    const body = await req.json()
    const { target_user_id } = body
    if (!target_user_id) return new Response('missing target_user_id', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // Atomically pick a single unused prekey and mark it used
    const sql = `with sel as (
      select prekey_id from prekeys where user_id = $1 and used = false limit 1 for update skip locked
    ) update prekeys set used = true from sel where prekeys.prekey_id = sel.prekey_id returning prekeys.*;`;

    // Use DB function to atomically consume a prekey
    const { data: pickedRows, error: pickedErr } = await sb.rpc('consume_prekey_for_user', { uid: target_user_id })
    let prekey = null
    if (!pickedRows || pickedRows.length === 0) {
      return new Response(JSON.stringify({ error: 'no prekeys' }), { status: 404 })
    } else {
      prekey = pickedRows[0]
    }

    // fetch user's public identity key & signed prekey bundle
    const { data: user, error: userErr } = await sb.from('users').select('public_identity_key, prekey_bundle').eq('id', target_user_id).single()
    if (userErr) return new Response(JSON.stringify({ error: userErr.message }), { status: 500 })

    const bundle = {
      public_identity_key: user.public_identity_key,
      signed_prekey: user.prekey_bundle?.signed_prekey || null,
      one_time_prekey: prekey?.prekey_public || null,
      one_time_prekey_id: prekey?.prekey_id || null
    }

    // audit
    try {
      const { signBody } = await import('../lib/signer.ts')
      const bodyLog = { function_name: 'consume-prekey', caller_id: null, event: { target_user_id } }
      const sig = await signBody(bodyLog)
      await fetch((Deno.env.get('SUPABASE_FUNCTIONS_URL')||'') + '/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig }, body: JSON.stringify(bodyLog) })
    } catch (_e) {}

    return new Response(JSON.stringify({ ok: true, bundle }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
