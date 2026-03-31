import { generateMnemonic } from '../lib/crypto-lite'

self.addEventListener('message', async (ev) => {
  const { type, payload } = ev.data || {}
  try {
    switch (type) {
      case 'generate-mnemonic': {
        const words = payload?.words === 24 ? 24 : 12
        // Ensure Node Buffer polyfill is available in the worker (bip39 expects Buffer)
        if (typeof (globalThis as any).Buffer === 'undefined') {
          // Lightweight shim implementing Buffer.from for common inputs used by bip39
          ;(globalThis as any).Buffer = {
            from(input: any, enc?: string) {
              if (typeof input === 'string') {
                if (enc === 'hex') {
                  const len = input.length / 2
                  const out = new Uint8Array(len)
                  for (let i = 0; i < len; i++) out[i] = parseInt(input.substr(i * 2, 2), 16)
                  return out
                }
                return new TextEncoder().encode(input)
              }
              if (ArrayBuffer.isView(input)) return new Uint8Array((input as any).buffer || input)
              if (input instanceof ArrayBuffer) return new Uint8Array(input)
              if (Array.isArray(input)) return new Uint8Array(input)
              return new Uint8Array(0)
            },
            alloc(size: number) { return new Uint8Array(size) },
            isBuffer(x: any) { return x instanceof Uint8Array }
          } as any
        }
        const m = await generateMnemonic(words)
        self.postMessage({ type: 'mnemonic', mnemonic: m })
        break
      }
      default:
        self.postMessage({ type: 'error', message: 'unknown task' })
    }
  } catch (err: any) {
    const msg = err?.message || String(err)
    const stack = err?.stack || null
    // Post error with stack if available for better debugging in UI
    try { self.postMessage({ type: 'error', message: msg, stack }) } catch (e) {}
  }
})

export {}
