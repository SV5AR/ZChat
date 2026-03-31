/**
 * Double Ratchet skeleton.
 * This module provides a class outline for a Double Ratchet state machine.
 * Implement complete spec (DH ratchet, root/chain key derivation, message keys,
 * skipped message handling, header packing) when ready.
 */

import x25519 from './x25519_shim'
import { deriveKeyMaterials } from './crypto'

type KeyPair = { priv: Uint8Array; pub: Uint8Array }

export class DoubleRatchet {
  rootKey: Uint8Array | null = null
  sendChainKey: Uint8Array | null = null
  recvChainKey: Uint8Array | null = null
  dhPair: KeyPair
  theirDhPub: Uint8Array | null = null
  sendMessageCounter = 0
  recvMessageCounter = 0
  _pendingNextSendChainKey: Uint8Array | null = null

  constructor(dhPair?: KeyPair) {
    const priv = crypto.getRandomValues(new Uint8Array(32))
    const pub = x25519.getPublicKey(priv) as Uint8Array
    this.dhPair = dhPair ?? { priv, pub }
  }

  async initializeFromHandshake(rootKey: Uint8Array, theirDhPub: Uint8Array) {
    this.rootKey = rootKey
    this.theirDhPub = theirDhPub
    // Derive initial chain keys from rootKey via HKDF (use deriveKeyMaterials for convenience)
    const seed = rootKey.length >= 64 ? rootKey.slice(0, 64) : (() => {
      const out = new Uint8Array(64)
      for (let i = 0; i < 64; i++) out[i] = rootKey[i % rootKey.length]
      return out
    })()
    const km = await deriveKeyMaterials(seed)
    this.sendChainKey = km.encRoot.slice(0, 32)
    this.recvChainKey = km.authKey.slice(0, 32)
  }

  async ratchetStep(theirNewDhPub: Uint8Array) {
    this.theirDhPub = theirNewDhPub
    // debug disabled by default in prod; enable via global flag if needed
    // Compute DH between our new DH private and their public
    const shared = x25519.getSharedSecret(this.dhPair.priv, theirNewDhPub) as Uint8Array
    // Use shared to derive a new root and chain keys
    const seed = shared.length >= 64 ? shared.slice(0, 64) : (() => {
      const out = new Uint8Array(64)
      for (let i = 0; i < 64; i++) out[i] = shared[i % shared.length]
      return out
    })()
    const km = await deriveKeyMaterials(seed)
    this.rootKey = km.preKeyRoot.slice(0, 32)
    this.sendChainKey = km.encRoot.slice(0, 32)
    this.recvChainKey = km.authKey.slice(0, 32)
    this.sendMessageCounter = 0
    this.recvMessageCounter = 0
  }

  deriveMessageKey(chainKey: Uint8Array) {
    // KDF: simple HKDF-like split (placeholder) — in production use HMAC-based HKDF
    const mk = chainKey.slice(0, 16)
    const next = chainKey.slice(16).length ? chainKey.slice(16) : crypto.getRandomValues(new Uint8Array(16))
    return { messageKey: mk, nextChainKey: next }
  }

  async encrypt(plaintext: Uint8Array) {
    if (!this.sendChainKey) throw new Error('sendChainKey not initialized')
    // If a pending next chain key is present (from previous encrypt), commit it
    // before deriving the next message key so the chain advances once per
    // message in a deterministic manner.
    if (this._pendingNextSendChainKey) {
      this.sendChainKey = this._pendingNextSendChainKey
      this._pendingNextSendChainKey = null
    }
    const { messageKey, nextChainKey } = this.deriveMessageKey(this.sendChainKey)
    // Record the next chain key for the upcoming message; do NOT overwrite
    // the public `sendChainKey` property yet so callers can observe the
    // pre-advance value immediately after `encrypt()` returns.
    this._pendingNextSendChainKey = nextChainKey
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const keyBytes = messageKey instanceof Uint8Array ? messageKey.slice() : new Uint8Array(messageKey)
    const key = await crypto.subtle.importKey('raw', keyBytes.buffer, 'AES-GCM', false, ['encrypt'])
    const plainBuf = plaintext.buffer instanceof ArrayBuffer ? plaintext.buffer as ArrayBuffer : new Uint8Array(plaintext).buffer
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuf)
    const header = { pub: Array.from(this.dhPair.pub), pn: 0, n: this.sendMessageCounter, iv: Array.from(iv) }
    this.sendMessageCounter += 1
    // zero any JS copies of the message key material (best-effort)
    try { (keyBytes as Uint8Array).fill(0) } catch (e) {}
    try { (messageKey as Uint8Array).fill(0) } catch (e) {}
    return { ct: new Uint8Array(ct), header }
  }

  async decrypt(header: any, ct: Uint8Array) {
    if (!this.recvChainKey) throw new Error('recvChainKey not initialized')
    const { messageKey, nextChainKey } = this.deriveMessageKey(this.recvChainKey)
    this.recvChainKey = nextChainKey
    const keyBytes = messageKey instanceof Uint8Array ? messageKey.slice() : new Uint8Array(messageKey)
    const key = await crypto.subtle.importKey('raw', keyBytes.buffer, 'AES-GCM', false, ['decrypt'])
    const ivArr = header?.iv ? new Uint8Array(header.iv) : new Uint8Array(12)
    const ctBuf = ct.buffer instanceof ArrayBuffer ? ct.buffer as ArrayBuffer : new Uint8Array(ct).buffer
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivArr }, key, ctBuf)
    // zero temporary JS-held key material (best-effort)
    try { (keyBytes as Uint8Array).fill(0) } catch (e) {}
    try { (messageKey as Uint8Array).fill(0) } catch (e) {}
    return new Uint8Array(plain)
  }
}

export default DoubleRatchet
