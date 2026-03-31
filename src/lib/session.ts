import { deriveFromMnemonic } from './crypto'
import localEncryptedDB from './localEncryptedDB'

const SESSION_TABLE = 'session'
const SESSION_ID = 'keys'

export async function createAndStoreSession(mnemonic: string, pin: string) {
  const keys = await deriveFromMnemonic(mnemonic)
  // derive an AES key from the user's PIN to encrypt private material
  const salt = new Uint8Array([9,8,7,6,5,4,3,2])
  const aesKey = await localEncryptedDB.deriveKeyFromPassword(pin, salt)

  // store private material encrypted
  const privs = {
    x25519: Array.from(keys.x25519.priv),
    ed25519: Array.from(keys.ed25519.priv),
    preKeyRoot: Array.from(keys.preKeyRoot),
    encRoot: Array.from(keys.encRoot),
    authKey: Array.from(keys.authKey)
  }

  await localEncryptedDB.encryptAndStore(SESSION_TABLE, SESSION_ID, privs, aesKey)

  // return public keys for uploading to server
  return {
    x25519_pub: Buffer.from(keys.x25519.pub).toString('hex'),
    ed25519_pub: Buffer.from(keys.ed25519.pub).toString('hex')
  }
}

export async function unlockSession(pin: string) {
  const salt = new Uint8Array([9,8,7,6,5,4,3,2])
  const aesKey = await localEncryptedDB.deriveKeyFromPassword(pin, salt)
  const data = await localEncryptedDB.getAndDecrypt(SESSION_TABLE, SESSION_ID, aesKey)
  if (!data) return null
  // convert arrays back to Uint8Array
  return {
    x25519_priv: new Uint8Array(data.x25519),
    ed25519_priv: new Uint8Array(data.ed25519),
    preKeyRoot: new Uint8Array(data.preKeyRoot),
    encRoot: new Uint8Array(data.encRoot),
    authKey: new Uint8Array(data.authKey)
  }
}

export async function clearSession() {
  await localEncryptedDB.deleteEntry(SESSION_TABLE, SESSION_ID)
}

export default { createAndStoreSession, unlockSession, clearSession }
