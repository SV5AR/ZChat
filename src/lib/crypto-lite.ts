import * as bip39 from 'bip39'

const encoder = (s: string) => new TextEncoder().encode(s)

export async function generateMnemonic(words: 12 | 24 = 12): Promise<string> {
  const strength = words === 24 ? 256 : 128
  return bip39.generateMnemonic(strength)
}

// export encoder for potential small helpers in the worker
export { encoder }
