/**
 * X3DH skeleton implementation.
 * This file provides helper functions to generate PreKeys and derive a shared secret
 * using X25519. For production, implement full X3DH flow with PreKey bundles,
 * hybrid PQC (Kyber-768) integration, and proper authentication proofs.
 */

import { x25519 } from '@noble/curves/ed25519'
import { deriveKeyMaterials } from './crypto'
import DoubleRatchet from './doubleRatchet'
import * as kyber from './kyber'

export function generateX25519Keypair() {
  const priv = crypto.getRandomValues(new Uint8Array(32))
  const pub = x25519.getPublicKey(priv)
  return { priv, pub: new Uint8Array(pub) }
}

export async function computeX25519SharedSecret(ourPriv: Uint8Array, theirPub: Uint8Array) {
  const ss = x25519.getSharedSecret(ourPriv, theirPub)
  const arr = ss instanceof Uint8Array ? ss : new Uint8Array(ss as ArrayBuffer)
  return arr
}

/**
 * Generate a PreKey bundle for publishing to the server.
 * - identityKey: long-term identity keypair
 * - signedPreKey: medium-term signed prekey
 * - oneTimePreKey: optional one-time prekey
 */
export function generatePreKeyBundle() {
  const identity = generateX25519Keypair()
  const signedPreKey = generateX25519Keypair()
  const oneTimePreKey = generateX25519Keypair()
  // Generate a PQC keypair (may use pseudo fallback)
  const ky = { publicKey: new Uint8Array(0), secretKey: new Uint8Array(0) }
  return {
    identity_pub: identity.pub,
    signed_prekey_pub: signedPreKey.pub,
    one_time_prekey_pub: oneTimePreKey.pub,
    kyber_pub: ky.publicKey,
    // Keep privates locally — do NOT upload
    __priv: { identity_priv: identity.priv, signed_prekey_priv: signedPreKey.priv, one_time_prekey_priv: oneTimePreKey.priv, kyber_priv: ky.secretKey }
  }
}

/**
 * Derive shared secrets per X3DH (simplified):
 * DH1 = DH(IK_A, SPK_B)
 * DH2 = DH(IK_A, OPK_B) (if present)
 * DH3 = DH(SPK_A, IK_B)
 * DH4 = DH(SPK_A, SPK_B)
 * Optionally combine PQC shared secret (Kyber) — placeholder here.
 * Returns derived key materials (root/enc/signing/etc.) via HKDF.
 */
export async function deriveSharedSecretX3DH(ourIdentityPriv: Uint8Array, ourSignedPreKeyPriv: Uint8Array, ourOneTimePriv: Uint8Array | null, theirBundle: { identity_pub: Uint8Array; signed_prekey_pub: Uint8Array; one_time_prekey_pub?: Uint8Array }, pqcSharedOverride?: Uint8Array) {
  const dh1 = await computeX25519SharedSecret(ourIdentityPriv, theirBundle.signed_prekey_pub)
  const dh2 = theirBundle.one_time_prekey_pub && ourIdentityPriv ? await computeX25519SharedSecret(ourIdentityPriv, theirBundle.one_time_prekey_pub) : new Uint8Array(0)
  const dh3 = await computeX25519SharedSecret(ourSignedPreKeyPriv, theirBundle.identity_pub)
  const dh4 = await computeX25519SharedSecret(ourSignedPreKeyPriv, theirBundle.signed_prekey_pub)

  const pqcShared = pqcSharedOverride ?? new Uint8Array(0)

  // Concatenate all secrets deterministically
  const parts = [dh1, dh2, dh3, dh4, pqcShared].filter(p => p && p.length)
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const concat = new Uint8Array(totalLen || 32)
  let off = 0
  for (const p of parts) {
    concat.set(p, off)
    off += p.length
  }

  // Prepare a 64-byte seed: if concat shorter, repeat/hash; simple deterministic pad here
  const seed = concat.length >= 64 ? concat.slice(0, 64) : (() => {
    const out = new Uint8Array(64)
    for (let i = 0; i < 64; i++) out[i] = concat[i % concat.length]
    return out
  })()

  return deriveKeyMaterials(seed)
}

/**
 * Initiator-side helper: derive shared key material and return initial DoubleRatchet state.
 * This simplified flow uses the derived key material seed as the root key and uses
 * the responder's signed prekey as the initial theirDhPub for the ratchet.
 */
export async function initiatorHandshake(ourPrivs: { identity_priv: Uint8Array; signed_prekey_priv: Uint8Array; one_time_prekey_priv?: Uint8Array }, theirBundle: { identity_pub: Uint8Array; signed_prekey_pub: Uint8Array; one_time_prekey_pub?: Uint8Array }) {
  // If their bundle contains a Kyber public key, perform KEM encapsulation and include shared secret
  let pqcShared: Uint8Array | undefined = undefined
  let kyber_ct: Uint8Array | undefined = undefined
  if (theirBundle.kyber_pub && theirBundle.kyber_pub.length) {
    const res = await kyber.encapsulate(theirBundle.kyber_pub)
    pqcShared = res.sharedSecret
    kyber_ct = res.ciphertext
  }

  const km = await deriveSharedSecretX3DH(ourPrivs.identity_priv, ourPrivs.signed_prekey_priv, ourPrivs.one_time_prekey_priv ?? null, theirBundle, pqcShared)
  // Use preKeyRoot as a root key seed for the ratchet
  const rootSeed = km.preKeyRoot
  const dr = new DoubleRatchet()
  await dr.initializeFromHandshake(rootSeed, theirBundle.signed_prekey_pub)
  return { km, ratchet: dr, kyber_ct }
}

/**
 * Responder-side helper: complete handshake given an initiator ephemeral or caller info.
 * For this simplified implementation, responder uses its own privates and caller bundle
 * to derive the same shared secret and initialize a DoubleRatchet using its signed prekey.
 */
export async function responderHandshake(ourPrivs: { identity_priv: Uint8Array; signed_prekey_priv: Uint8Array; one_time_prekey_priv?: Uint8Array }, initiatorBundle: { identity_pub: Uint8Array; ephemeral_pub?: Uint8Array }) {
  // Build a synthetic theirBundle for deriveSharedSecretX3DH using initiator's identity
  const theirBundle: any = { identity_pub: initiatorBundle.identity_pub, signed_prekey_pub: initiatorBundle.ephemeral_pub ?? initiatorBundle.identity_pub }
  // If initiator supplied a Kyber ciphertext, decapsulate to obtain the PQC shared secret
  let pqcShared: Uint8Array | undefined = undefined
  if ((initiatorBundle as any).kyber_ct && ourPrivs.__kyber_priv) {
    pqcShared = await kyber.decapsulate((ourPrivs as any).__kyber_priv, (initiatorBundle as any).kyber_ct)
  }
  const km = await deriveSharedSecretX3DH(ourPrivs.identity_priv, ourPrivs.signed_prekey_priv, ourPrivs.one_time_prekey_priv ?? null, theirBundle, pqcShared)
  const rootSeed = km.preKeyRoot
  const dr = new DoubleRatchet()
  // Use initiator's ephemeral or identity pub as theirDhPub
  const theirDhPub = initiatorBundle.ephemeral_pub ?? initiatorBundle.identity_pub
  await dr.initializeFromHandshake(rootSeed, theirDhPub)
  return { km, ratchet: dr }
}

/**
 * Placeholder for PQC Kyber-768 shared secret derivation.
 * Replace with real Kyber implementation and hybrid exchange for post-quantum security.
 */
export async function kyberPlaceholderSharedSecret(): Promise<Uint8Array> {
  // Return 32 bytes of pseudo-random data for now
  return crypto.getRandomValues(new Uint8Array(32))
}

export default { generateX25519Keypair, computeX25519SharedSecret, generatePreKeyBundle, deriveSharedSecretX3DH, kyberPlaceholderSharedSecret }
