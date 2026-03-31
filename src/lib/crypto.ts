import * as bip39 from 'bip39'
import { ed25519, x25519 } from '@noble/curves/ed25519'
// argon2-browser is optional; we dynamically import it where available.

const encoder = (s: string) => new TextEncoder().encode(s)

export async function generateMnemonic(words: 12 | 24 = 12): Promise<string> {
  const strength = words === 24 ? 256 : 128
  return bip39.generateMnemonic(strength)
}

/**
 * Derive a 512-bit (64-byte) seed from a mnemonic using Argon2id.
 * This is deterministic for the same mnemonic and fixed salt.
 * NOTE: The salt choice affects determinism — we use a fixed app salt to keep it reproducible.
 */
export async function deriveSeedFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  const salt = encoder('zchat-argon2-salt')
  // Derive using Argon2id via the bundled UMD + wasm asset.
  // This function requires Argon2 to initialize successfully; on failure it throws.
  try {
    // Ensure the wasm is emitted as an asset and get its URL via Vite's ?url import
    const wasmModule: any = await import('argon2-browser/dist/argon2.wasm?url')
    const wasmUrl: string = wasmModule?.default || wasmModule

    // Provide locateFile so the UMD bundle can find the wasm at runtime
    ;(globalThis as any).Module = (globalThis as any).Module || {}
    ;(globalThis as any).Module.locateFile = (path: string) => (path && path.endsWith('.wasm')) ? wasmUrl : path

    // Import the bundled UMD glue that will use Module.locateFile to fetch the wasm
    const mod: any = await import('argon2-browser/dist/argon2-bundled.min.js')

    // Resolve argon2 export from several possible shapes
    let argon2: any = mod?.argon2 || mod?.default?.argon2 || mod?.default || (globalThis as any).argon2
    if (!argon2 && typeof mod === 'function') {
      const inst = await (mod as any)()
      argon2 = inst?.argon2 || inst?.default?.argon2 || (globalThis as any).argon2
    }

    if (!argon2 || typeof argon2.hash !== 'function') throw new Error('argon2 initialization failed')

    const res = await argon2.hash({
      pass: mnemonic,
      salt: Array.from(salt),
      time: 3,
      mem: 1 << 16,
      parallelism: 1,
      hashLen: 64,
      type: argon2.ArgonType?.Argon2id ?? 2
    })

    const hashBuf = res.hash as Uint8Array
    return new Uint8Array(hashBuf.slice(0, 64))
  } catch (err) {
    // Propagate error without noisy console logging; caller will handle it.
    throw err
  }

}

async function hkdfExpand(ikm: Uint8Array, info: string, length: number): Promise<Uint8Array> {
  const salt = encoder('zchat-hkdf-salt')
  const keyData = ikm.buffer instanceof ArrayBuffer ? ikm.buffer : new Uint8Array(ikm).buffer
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HKDF' }, false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: encoder(info) },
    key,
    length * 8
  )
  return new Uint8Array(derived)
}

export async function deriveKeyMaterials(seed: Uint8Array) {
  if (seed.length < 32) throw new Error('seed too short')

  // Identity (X25519) — 32 bytes
  const xPriv = await hkdfExpand(seed, 'identity:x25519', 32)
  const xPub = x25519.getPublicKey(xPriv)

  // Signing (Ed25519) — 32 bytes
  const edPriv = await hkdfExpand(seed, 'signing:ed25519', 32)
  const edPub = ed25519.getPublicKey(edPriv)

  // PreKeys root (example) — 32 bytes
  const preKeyRoot = await hkdfExpand(seed, 'prekeys:root', 32)

  // Encryption root key — 32 bytes
  const encRoot = await hkdfExpand(seed, 'encryption:root', 32)

  // Auth token key — 32 bytes
  const authKey = await hkdfExpand(seed, 'auth:token', 32)

  return {
    x25519: { priv: xPriv, pub: new Uint8Array(xPub) },
    ed25519: { priv: edPriv, pub: new Uint8Array(edPub) },
    preKeyRoot,
    encRoot,
    authKey
  }
}

/**
 * Convenience: mnemonic -> seed -> key materials
 */
export async function deriveFromMnemonic(mnemonic: string) {
  const seed = await deriveSeedFromMnemonic(mnemonic)
  return deriveKeyMaterials(seed)
}
