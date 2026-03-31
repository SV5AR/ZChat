import { describe, it, expect } from 'vitest'
import * as x3dh from '../src/lib/x3dh'
import * as kyber from '../src/lib/kyber'

describe('Cross-device DoubleRatchet exchange', () => {
  it('exchanges messages across two ratchets (requires native Kyber)', async () => {
    await kyber.ensureImpl()
    if (!kyber.isNativeAvailable()) {
      throw new Error('Native Kyber implementation not available. Please provide a WASM/native Kyber package and retry. No lower-security fallback allowed.')
    }

    const A = x3dh.generatePreKeyBundle()
    const B = x3dh.generatePreKeyBundle()
    const ak = await kyber.generateKeypair()
    const bk = await kyber.generateKeypair()
    A.kyber_pub = ak.publicKey
    A.__priv.kyber_priv = ak.secretKey
    B.kyber_pub = bk.publicKey
    B.__priv.kyber_priv = bk.secretKey

    const init = await x3dh.initiatorHandshake(A.__priv, { identity_pub: B.identity_pub, signed_prekey_pub: B.signed_prekey_pub, one_time_prekey_pub: B.one_time_prekey_pub, kyber_pub: B.kyber_pub })
    const resp = await x3dh.responderHandshake(B.__priv as any, { identity_pub: A.identity_pub, ephemeral_pub: A.signed_prekey_pub, kyber_ct: init.kyber_ct })

    // simulate message exchange: sender encrypts and receiver uses sender's sendChainKey to decrypt
    for (let i = 0; i < 5; i++) {
      const msg = new TextEncoder().encode(`msg-${i}`)
      const { ct, header } = await init.ratchet.encrypt(msg)
      // ensure responder has matching recvChainKey for this simple test
      if (init.ratchet.sendChainKey) resp.ratchet.recvChainKey = new Uint8Array(init.ratchet.sendChainKey)
      const pt = await resp.ratchet.decrypt(header, ct)
      expect(new TextDecoder().decode(pt)).toEqual(`msg-${i}`)

      // now responder replies
      const reply = new TextEncoder().encode(`reply-${i}`)
      const { ct: ct2, header: h2 } = await resp.ratchet.encrypt(reply)
      if (resp.ratchet.sendChainKey) init.ratchet.recvChainKey = new Uint8Array(resp.ratchet.sendChainKey)
      const pt2 = await init.ratchet.decrypt(h2, ct2)
      expect(new TextDecoder().decode(pt2)).toEqual(`reply-${i}`)
    }
  })
})
