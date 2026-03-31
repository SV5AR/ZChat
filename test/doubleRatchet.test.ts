import { describe, it, expect, vi } from 'vitest'
import * as x3dh from '../src/lib/x3dh'
import * as kyber from '../src/lib/kyber'

describe('DoubleRatchet bootstrap', () => {
  it('initializes ratchets from handshake and can encrypt/decrypt locally', async () => {
    const A = x3dh.generatePreKeyBundle()
    const B = x3dh.generatePreKeyBundle()
    const ak = await kyber.generateKeypair()
    const bk = await kyber.generateKeypair()
    A.kyber_pub = ak.publicKey
    A.__priv.kyber_priv = ak.secretKey
    B.kyber_pub = bk.publicKey
    B.__priv.kyber_priv = bk.secretKey

    const initiator = await x3dh.initiatorHandshake(A.__priv, { identity_pub: B.identity_pub, signed_prekey_pub: B.signed_prekey_pub, one_time_prekey_pub: B.one_time_prekey_pub, kyber_pub: B.kyber_pub })
    const responder = await x3dh.responderHandshake(B.__priv as any, { identity_pub: A.identity_pub, ephemeral_pub: A.signed_prekey_pub, kyber_ct: initiator.kyber_ct })

    expect(initiator.km.preKeyRoot).toBeDefined()
    expect(responder.km.preKeyRoot).toBeDefined()
    expect(initiator.ratchet).toBeDefined()
    expect(responder.ratchet).toBeDefined()

    // Basic local encrypt/decrypt on same ratchet instance
    const msg = new TextEncoder().encode('hello ratchet')
    // Capture chainKey used for encryption so we can set recvChainKey to same value for local decrypt
    const chainKey = initiator.ratchet.sendChainKey ? new Uint8Array(initiator.ratchet.sendChainKey) : null
    const { ct, header } = await initiator.ratchet.encrypt(msg)
    if (chainKey) initiator.ratchet.recvChainKey = chainKey
    const pt = await initiator.ratchet.decrypt(header, ct)
    expect(new TextDecoder().decode(pt)).toEqual('hello ratchet')
  })
})
