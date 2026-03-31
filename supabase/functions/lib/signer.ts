// HMAC signer for function-to-function authentication
// Uses SUPABASE_INTERNAL_HMAC_KEY env var (raw secret)

function b64(arr) { return typeof btoa === 'function' ? btoa(String.fromCharCode(...new Uint8Array(arr))) : Buffer.from(arr).toString('base64') }
function abToU8(ab){ return new Uint8Array(ab) }

export async function signBody(body) {
  const key = Deno.env.get('SUPABASE_INTERNAL_HMAC_KEY')
  if (!key) throw new Error('missing SUPABASE_INTERNAL_HMAC_KEY')
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const data = enc.encode(JSON.stringify(body))
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return b64(abToU8(sig))
}

export async function verifyBodySignature(body, signature) {
  const key = Deno.env.get('SUPABASE_INTERNAL_HMAC_KEY')
  if (!key) throw new Error('missing SUPABASE_INTERNAL_HMAC_KEY')
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const data = enc.encode(JSON.stringify(body))
  const sigBuf = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
  return await crypto.subtle.verify('HMAC', cryptoKey, sigBuf, data)
}
