// Encrypted local DB placeholder using IndexedDB + WebCrypto AES-GCM.
// Provides a secure local cache until SQLCipher integration is implemented.

const DB_NAME = 'zchat-localdb'
const STORE_NAME = 'entries'
const encoder = (s: string) => new TextEncoder().encode(s)
const decoder = (b: Uint8Array) => new TextDecoder().decode(b)

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putRaw(key: string, value: any) {
  const db = await openIDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put({ key, value })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getRaw(key: string) {
  const db = await openIDB()
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result?.value ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function deriveKeyFromPassword(password: string, salt: Uint8Array) {
  const baseKey = await crypto.subtle.importKey('raw', encoder(password), 'PBKDF2', false, ['deriveKey'])
  const saltBuf = salt?.buffer instanceof ArrayBuffer ? salt.buffer as ArrayBuffer : new Uint8Array(salt).buffer
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf, iterations: 200000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return key
}

export async function encryptAndStore(table: string, id: string, data: any, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder(JSON.stringify(data))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const payload = { iv: arrayBufferToBase64(iv.buffer), ct: arrayBufferToBase64(cipher), ts: Date.now() }
  await putRaw(`${table}:${id}`, payload)
}

export async function getAndDecrypt(table: string, id: string, key: CryptoKey) {
  const payload = await getRaw(`${table}:${id}`)
  if (!payload) return null
  const iv = base64ToUint8Array(payload.iv)
  const ct = base64ToUint8Array(payload.ct)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct.buffer)
    return JSON.parse(decoder(new Uint8Array(plain)))
  } catch (e) {
    return null
  }
}

export async function allEntries(table: string) {
  const db = await openIDB()
  return new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const rows = (req.result as any[]).filter(r => r.key.startsWith(table + ':')).map(r => ({ key: r.key, value: r.value }))
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUint8Array(b64: string) {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function deleteEntry(table: string, id: string) {
  const db = await openIDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(`${table}:${id}`)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAll() {
  const db = await openIDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export default {
  deriveKeyFromPassword,
  encryptAndStore,
  getAndDecrypt,
  allEntries,
  deleteEntry,
  clearAll
}
