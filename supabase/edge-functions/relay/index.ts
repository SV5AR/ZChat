/**
 * Supabase Edge Function: relay
 * Purpose: blind relay for encrypted packets. MUST NOT decrypt data here.
 * This is a template — deploy with the Supabase CLI and implement validation logic.
 */

import { serve } from 'std/server'

/**
 * Relay Edge Function (template)
 * - Validates packet envelope shape
 * - Performs light rate-limiting (in-memory; for production use Redis or a dedicated store)
 * - Acts as a blind relay only; MUST NOT attempt to decrypt payloads
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 60
const rateMap = new Map<string, { count: number; windowStart: number }>()

serve(async (req) => {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return new Response('invalid body', { status: 400 })

    // Basic shape validation
    if (!body.envelope || !body.signature) return new Response('missing envelope/signature', { status: 400 })

    // Rate limiting by IP (blind, approximate)
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || req.conn?.remoteAddr?.hostname || 'unknown'
    const entry = rateMap.get(ip) || { count: 0, windowStart: Date.now() }
    const now = Date.now()
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry.windowStart = now
      entry.count = 0
    }
    entry.count += 1
    rateMap.set(ip, entry)
    if (entry.count > MAX_REQUESTS_PER_WINDOW) return new Response('rate limit exceeded', { status: 429 })

    // TODO: Validate signature against stored public keys in DB (edge function should query Postgres for sender public key)
    // For now accept and return accepted.
    return new Response(JSON.stringify({ status: 'accepted' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  } catch (err) {
    return new Response('server error', { status: 500 })
  }
})
