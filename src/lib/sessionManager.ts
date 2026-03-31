import { x25519 } from '@noble/curves/ed25519'
import kyber from './kyber'
import DoubleRatchet from './doubleRatchet'
import { initSupabase, publishEnvelope } from './supabaseClient'

function bufToB64(b: Uint8Array) { return btoa(String.fromCharCode(...b)) }
function b64ToBuf(s: string) { return new Uint8Array(atob(s).split('').map(c=>c.charCodeAt(0))) }

async function hkdf(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array | null, len = 32) {
  const alg = { name: 'HKDF', hash: 'SHA-256', salt: salt || new Uint8Array([]), info: info || new Uint8Array([]) }
  const key = await crypto.subtle.importKey('raw', ikm.buffer, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(alg, key, len * 8)
  return new Uint8Array(bits)
}

type Session = { ratchet: DoubleRatchet }

const sessions: Record<string, Session> = {}

export async function ensureIdentity(){
  const existing = localStorage.getItem('id_priv')
  if(existing){
    const priv = b64ToBuf(localStorage.getItem('id_priv')!)
    const pub = b64ToBuf(localStorage.getItem('id_pub')!)
    return { priv, pub }
  }
  const priv = crypto.getRandomValues(new Uint8Array(32))
  const pub = x25519.getPublicKey(priv) as Uint8Array
  localStorage.setItem('id_priv', bufToB64(priv))
  localStorage.setItem('id_pub', bufToB64(pub))
  return { priv, pub }
}

export async function ensureKyberKeypair(){
  const existing = localStorage.getItem('kyber_sk')
  if(existing){
    return { pk: b64ToBuf(localStorage.getItem('kyber_pk')!), sk: b64ToBuf(existing) }
  }
  const m = await kyber.generateKeypair()
  const pk = m.publicKey as Uint8Array
  const sk = m.secretKey as Uint8Array
  localStorage.setItem('kyber_pk', bufToB64(pk))
  localStorage.setItem('kyber_sk', bufToB64(sk))
  return { pk, sk }
}

export async function publishPrekey() {
  const id = await ensureIdentity()
  const k = await ensureKyberKeypair()
  // publish to Supabase table `prekeys` with columns: id, x25519_pub, kyber_pk
  const envelope = { id: bufToB64(id.pub), x25519_pub: Array.from(id.pub), kyber_pk: Array.from(k.pk), ts: new Date().toISOString() }
  try { await publishEnvelope('prekeys', envelope) } catch (e) { /* best-effort */ }
}

export async function fetchPrekey(recipientId: string){
  // Simple fetch via Supabase REST (we have supabase client elsewhere). For now use fetch to public REST endpoint if available.
  // Here we assume prekeys table is readable via Supabase client - use the client directly.
  try {
    const sb = initSupabase((import.meta.env.VITE_SUPABASE_URL as string) || '', (import.meta.env.VITE_SUPABASE_KEY as string) || '')
  } catch (e) {}
  // This file keeps logic minimal; messaging layer will fetch prekeys via supabaseClient if needed.
  return null
}

export async function initiateSession(to:string, toBundle:any, initialPlaintext?:string){
  // toBundle should contain x25519_pub (array) and kyber_pk (array)
  const id = await ensureIdentity()
  const ourPriv = id.priv
  const ourPub = id.pub
  const theirX = new Uint8Array(toBundle.x25519_pub)
  const theirKyberPk = new Uint8Array(toBundle.kyber_pk)

  // generate ephemeral x25519
  const ephPriv = crypto.getRandomValues(new Uint8Array(32))
  const ephPub = x25519.getPublicKey(ephPriv) as Uint8Array

  // perform Kyber encapsulation to their Kyber public key
  const kem = await kyber.encapsulate(theirKyberPk)
  const kyberShared = kem.sharedSecret as Uint8Array
  const kyberCt = kem.ciphertext as Uint8Array

  // compute X25519 shared: our ephemeral priv with their identity pub
  const xShared = x25519.getSharedSecret(ephPriv, theirX) as Uint8Array

  // derive root key from concat(shared)
  const concat = new Uint8Array(xShared.length + kyberShared.length)
  concat.set(xShared, 0); concat.set(kyberShared, xShared.length)
  const rootKey = await hkdf(concat, null, null, 32)

  // initialize DoubleRatchet with rootKey and their DH pub (their identity pub)
  const dr = new DoubleRatchet()
  await dr.initializeFromHandshake(rootKey, theirX)

  sessions[to] = { ratchet: dr }

  // prepare initial encrypted body using rootKey-derived AES key
  const info = new TextEncoder().encode('init')
  const msgKey = await hkdf(rootKey, null, info, 32)
  const key = await crypto.subtle.importKey('raw', msgKey.buffer, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plainBuf = new TextEncoder().encode(initialPlaintext || '')
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuf)

  // zero sensitive temporaries
  try{ xShared.fill(0); kyberShared.fill(0); concat.fill(0); msgKey.fill(0); } catch(e) {}

  return {
    type: 'handshake',
    to,
    from: bufToB64(ourPub),
    eph_pub: Array.from(ephPub),
    kyber_ct: Array.from(kyberCt),
    iv: Array.from(iv),
    body: Array.from(new Uint8Array(ct))
  }
}

export async function handleIncomingHandshake(rec:any){
  // rec: { from, eph_pub, kyber_ct, iv, body }
  const our = await ensureIdentity()
  const ourKy = await ensureKyberKeypair()
  const theirPub = b64ToBuf(rec.from)
  const ephPub = new Uint8Array(rec.eph_pub || [])
  const kyberCt = new Uint8Array(rec.kyber_ct || [])
  const iv = new Uint8Array(rec.iv || [])
  const body = new Uint8Array(rec.body || [])

  // decapsulate kyber
  const kyberShared = await kyber.decapsulate(ourKy.sk, kyberCt)

  // x25519 shared: our identity priv with their ephemeral pub
  const xShared = x25519.getSharedSecret(our.priv, ephPub) as Uint8Array

  const concat = new Uint8Array(xShared.length + kyberShared.length)
  concat.set(xShared, 0); concat.set(kyberShared, xShared.length)
  const rootKey = await hkdf(concat, null, null, 32)

  const dr = new DoubleRatchet()
  await dr.initializeFromHandshake(rootKey, theirPub)
  sessions[rec.from] = { ratchet: dr }

  // derive initial message key and decrypt body
  const info = new TextEncoder().encode('init')
  const msgKey = await hkdf(rootKey, null, info, 32)
  const key = await crypto.subtle.importKey('raw', msgKey.buffer, 'AES-GCM', false, ['decrypt'])
  let plaintext = ''
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body.buffer)
    plaintext = new TextDecoder().decode(plain)
  } catch (e) {
    // ignore
  }

  try{ xShared.fill(0); kyberShared.fill(0); concat.fill(0); (msgKey as Uint8Array).fill(0) } catch(e) {}
  return plaintext
}

export function getSession(to:string){
  return sessions[to] || null
}

export default { ensureIdentity, ensureKyberKeypair, publishPrekey, initiateSession, getSession }
