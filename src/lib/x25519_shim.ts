import nacl from 'tweetnacl'

// Minimal X25519 shim using tweetnacl's scalarMult helpers.
// Exposes `getPublicKey(priv)` and `getSharedSecret(priv, pub)` to match
// the small subset used by the codebase.

export const x25519 = {
  getPublicKey(priv: Uint8Array) {
    // ensure 32-byte private scalar
    const sk = new Uint8Array(priv.slice(0, 32))
    return nacl.scalarMult.base(sk)
  },
  getSharedSecret(priv: Uint8Array, theirPub: Uint8Array) {
    const sk = new Uint8Array(priv.slice(0, 32))
    const pk = new Uint8Array(theirPub.slice(0, 32))
    return nacl.scalarMult(sk, pk)
  },
}

export default x25519
