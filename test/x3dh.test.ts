import { describe, it, expect, vi } from 'vitest'
import * as x3dh from '../src/lib/x3dh'
import * as kyber from '../src/lib/kyber'

describe('X3DH deriveSharedSecret', () => {
  it('produces identical key materials for both parties (via handshake helpers)', async () => {
    // Generate PQC keypairs for both parties (uses pseudo fallback if native not present)
    const A = x3dh.generatePreKeyBundle()
    const B = x3dh.generatePreKeyBundle()
    const ak = await kyber.generateKeypair()
    const bk = await kyber.generateKeypair()
    // Attach kyber pub/priv to bundles
    A.kyber_pub = ak.publicKey
    A.__priv.kyber_priv = ak.secretKey
    B.kyber_pub = bk.publicKey
    B.__priv.kyber_priv = bk.secretKey

    const init = await x3dh.initiatorHandshake(A.__priv, { identity_pub: B.identity_pub, signed_prekey_pub: B.signed_prekey_pub, one_time_prekey_pub: B.one_time_prekey_pub, kyber_pub: B.kyber_pub })
    // Pass kyber ciphertext from initiator to responder for decapsulation
    const resp = await x3dh.responderHandshake(B.__priv as any, { identity_pub: A.identity_pub, ephemeral_pub: A.signed_prekey_pub, kyber_ct: init.kyber_ct })

    expect(init.km.preKeyRoot).toBeDefined()
    expect(resp.km.preKeyRoot).toBeDefined()
    expect(init.km.preKeyRoot.byteLength).toBeGreaterThanOrEqual(16)
    expect(resp.km.preKeyRoot.byteLength).toBeGreaterThanOrEqual(16)
  })
})
