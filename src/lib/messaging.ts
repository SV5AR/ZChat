import { ed25519 } from '@noble/curves/ed25519'

function toHex(b: Uint8Array) { return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('') }
function bufToBase64(b: ArrayBuffer) {
  const arr = new Uint8Array(b)
  let s = ''
  for (let i=0;i<arr.length;i++) s += String.fromCharCode(arr[i])
  return btoa(s)
}

export async function createEncryptedPacket(plaintext: string, toUuid: string, fromUuid: string, sessionPrivs: any) {
  // derive AES-GCM key from encRoot
  const encRoot = sessionPrivs.encRoot as Uint8Array
  const keyData = encRoot?.buffer instanceof ArrayBuffer ? encRoot.buffer as ArrayBuffer : new Uint8Array(encRoot).buffer
  const aesKey = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext))

  // create envelope
  const envelope = {
    version: 1,
    to: toUuid,
    from: fromUuid,
    iv: bufToBase64(iv.buffer),
    ct: bufToBase64(ct),
    ts: Date.now()
  }

  // sign envelope with Ed25519
  const msg = new TextEncoder().encode(JSON.stringify(envelope))
  const signature = ed25519.sign(msg, sessionPrivs.ed25519_priv)

  return { envelope, signature: toHex(signature) }
}

export async function sendPacket(relayUrl: string, packet: any) {
  const res = await fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) })
  return res
}

export default { createEncryptedPacket, sendPacket }
