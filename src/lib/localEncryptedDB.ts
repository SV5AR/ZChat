import argon2 from 'argon2-browser'

function b64(buf: Uint8Array){ return btoa(String.fromCharCode(...buf)) }
function fromB64(s: string){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)) }

let masterKey: CryptoKey | null = null
const SALT_KEY = 'enc_salt_v1'

export async function initEncryptedStore(pin: string) {
  // obtain or create salt
  let salt = localStorage.getItem(SALT_KEY)
  if(!salt){
    const s = crypto.getRandomValues(new Uint8Array(16))
    localStorage.setItem(SALT_KEY, b64(s))
    salt = b64(s)
  }
  const saltBuf = fromB64(salt)
  const pass = new TextEncoder().encode(pin)
  const hash = await argon2.hash({ pass, salt: saltBuf, time: 3, mem: 1<<18, parallelism: 1, hashLen: 32, type: argon2.ArgonType.Argon2id })
  const keyBytes = Uint8Array.from(atob(hash.hash), c=>c.charCodeAt(0))
  masterKey = await crypto.subtle.importKey('raw', keyBytes.buffer, 'AES-GCM', false, ['encrypt','decrypt'])
  // zero keyBytes
  try{ keyBytes.fill(0) } catch(e){}
  return true
}

async function ensureKey(){
  if(masterKey) return masterKey
  throw new Error('encrypted store not initialized; call initEncryptedStore(pin)')
}

export async function setItem(name: string, value: any){
  const key = await ensureKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const payload = { iv: Array.from(iv), body: Array.from(new Uint8Array(ct)) }
  localStorage.setItem('enc:'+name, JSON.stringify(payload))
}

export async function getItem(name: string){
  const key = await ensureKey()
  const raw = localStorage.getItem('enc:'+name)
  if(!raw) return null
  const obj = JSON.parse(raw)
  const iv = new Uint8Array(obj.iv || [])
  const body = new Uint8Array(obj.body || [])
  try{
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body.buffer)
    return JSON.parse(new TextDecoder().decode(plain))
  } catch (e) {
    return null
  }
}

export async function removeItem(name:string){
  localStorage.removeItem('enc:'+name)
}

export async function clearStore(){
  for(const k of Object.keys(localStorage)){
    if(k.startsWith('enc:')) localStorage.removeItem(k)
  }
}

export default { initEncryptedStore, setItem, getItem, removeItem, clearStore }
