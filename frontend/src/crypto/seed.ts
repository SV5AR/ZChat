import * as bip39 from 'bip39'
import argon2 from 'argon2-browser'

export async function deriveSeedFromMnemonic(mnemonic, opts = { time: 4, mem: 1<<20, parallelism: 4 }) {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('invalid mnemonic')
  const phraseBytes = new TextEncoder().encode(mnemonic)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await argon2.hash({ pass: phraseBytes, salt, time: opts.time, mem: opts.mem, parallelism: opts.parallelism, hashLen: 64, type: argon2.ArgonType.Argon2id })
  // argon2-wasm.hash returns { hash: base64 }
  const seed = Uint8Array.from(atob(hash.hash), c => c.charCodeAt(0))
  return seed
}
