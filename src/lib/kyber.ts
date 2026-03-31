/**
 * Kyber WASM loader (strict, no fallback).
 *
 * Expectations:
 * - Place a Kyber WASM glue JS named `kyber-bundled.min.js` and its `kyber.wasm`
 *   asset under `src/lib/kyber-wasm/` (or update import paths here).
 * - The glue must export `generateKeypair() -> { publicKey, secretKey }`,
 *   `encapsulate(pk) -> { sharedSecret, ciphertext }`, and
 *   `decapsulate(sk, ct) -> sharedSecret`.
 *
 * This module deliberately refuses to provide a lower-security fallback. If
 * the wasm/glue isn't present the functions will throw with instructions.
 */

let impl: any = null
let usedNative = false
const KYBER_DEBUG = true

async function loadBundledWasm() {
  try {
    ;(globalThis as any).Module = (globalThis as any).Module || {}
    // Prefer a file-relative absolute URL so the glue can locate the wasm both
    // in browser bundlers and in Node test environments.
    try {
      const wasmUrl = new URL('./kyber-wasm/kyber.wasm', import.meta.url).href
      ;(globalThis as any).Module.locateFile = (path: string) => {
        if (path.endsWith('.wasm')) return wasmUrl
        return path
      }
    } catch (e) {
      ;(globalThis as any).Module.locateFile = (path: string) => path
    }

    let glue: any = null
    try {
      glue = await import('./kyber-wasm/kyber-bundled.min.js')
    } catch (e) {
      // ignore import errors and try CommonJS require below
      glue = null
    }
    let possible = glue && (glue.default || glue)
    // If import didn't return the expected API (common when the glue is
    // CommonJS/UMD), and we're running under Node, try loading via
    // createRequire so CommonJS exports are resolved.
    if (( !possible || (typeof possible !== 'function' && Object.keys(possible).length === 0) ) &&
        typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const { createRequire } = await import('module')
        const requireFn = createRequire(import.meta.url)
        const mod = requireFn(new URL('./kyber-wasm/kyber-bundled.min.js', import.meta.url))
        possible = mod && (mod.default || mod)
      } catch (e) {
        // fall through and let the generic checks handle failure
      }
    }
    // If the imported asset is an Emscripten factory function, instantiate and
    // create a small JS API around the Module's cwrap/HEAPU8 helpers.
    if (typeof possible === 'function') {
      const Module = await possible()
      try { console.debug && console.debug('kyber.Module.keys', Object.keys(Module)) } catch (e) {}
      // helper to build JS API
      // Expect the Emscripten Module to expose the PQClean symbol sizes and
      // functions (prefixed with _PQCLEAN...). If those aren't present we'll
      // let the later checks throw a descriptive error.
      function readBytes(ptr, len) {
        return new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + len))
      }
      function writeRandom(ptr, len) {
        const tmp = crypto.getRandomValues(new Uint8Array(len))
        Module.HEAPU8.set(tmp, ptr)
      }
      const api: any = {}
      api.generateKeypair = () => {
        // Kyber-768 parameter fallbacks (from pqclean params.h)
        const pkLen = Module._PQCLEAN_MLKEM768_CLEAN_CRYPTO_PUBLICKEYBYTES || Module._PQC_PK_BYTES || 1184
        const skLen = Module._PQCLEAN_MLKEM768_CLEAN_CRYPTO_SECRETKEYBYTES || Module._PQC_SK_BYTES || 2400
        const pkPtr = Module._malloc(pkLen)
        const skPtr = Module._malloc(skLen)
        try {
          // Debug helpers when running under Node/Vitest to surface sizes/pointers
          try { console.debug && console.debug('kyber.generateKeypair', { pkLen, skLen, pkPtr, skPtr }) } catch (e) {}
          const rc = Module._PQCLEAN_MLKEM768_CLEAN_crypto_kem_keypair(pkPtr, skPtr)
          const pk = readBytes(pkPtr, pkLen)
          const sk = readBytes(skPtr, skLen)
          return { publicKey: pk, secretKey: sk }
        } finally {
          try { Module._free(pkPtr); Module._free(skPtr) } catch (e) { /* ignore */ }
        }
      }
      api.encapsulate = (pk: Uint8Array) => {
        const ctLen = Module._PQCLEAN_MLKEM768_CLEAN_CRYPTO_CIPHERTEXTBYTES || Module._PQC_CT_BYTES || 1088
        const ssLen = Module._PQCLEAN_MLKEM768_CLEAN_CRYPTO_BYTES || Module._PQC_SS_BYTES || 32
        const pkPtr = Module._malloc(pk.length)
        Module.HEAPU8.set(pk, pkPtr)
        const ctPtr = Module._malloc(ctLen)
        const ssPtr = Module._malloc(ssLen)
        Module._PQCLEAN_MLKEM768_CLEAN_crypto_kem_enc(ctPtr, ssPtr, pkPtr)
        const ct = readBytes(ctPtr, ctLen)
        const ss = readBytes(ssPtr, ssLen)
        Module._free(pkPtr); Module._free(ctPtr); Module._free(ssPtr)
        return { sharedSecret: ss, ciphertext: ct }
      }
      api.decapsulate = (sk: Uint8Array, ct: Uint8Array) => {
        const ssLen = Module._PQCLEAN_MLKEM768_CLEAN_CRYPTO_BYTES || Module._PQC_SS_BYTES || 32
        const skPtr = Module._malloc(sk.length)
        Module.HEAPU8.set(sk, skPtr)
        const ctPtr = Module._malloc(ct.length)
        Module.HEAPU8.set(ct, ctPtr)
        const ssPtr = Module._malloc(ssLen)
        Module._PQCLEAN_MLKEM768_CLEAN_crypto_kem_dec(ssPtr, ctPtr, skPtr)
        const ss = readBytes(ssPtr, ssLen)
        Module._free(skPtr); Module._free(ctPtr); Module._free(ssPtr)
        return ss
      }
      return api
    }
    const m = possible
    if (!m || typeof m.generateKeypair !== 'function' || typeof m.encapsulate !== 'function' || typeof m.decapsulate !== 'function') {
      throw new Error('Kyber glue did not expose the expected API (generateKeypair/encapsulate/decapsulate)')
    }
    return m
  } catch (err) {
    // Surface load errors to the test run logs to aid debugging
    try { console.error('kyber.loadBundledWasm error:', err) } catch (e) {}
    return null
  }
}

export async function ensureImpl() {
  if (KYBER_DEBUG) try { console.debug('kyber.ensureImpl: enter') } catch (e) {}
  if (impl) {
    if (KYBER_DEBUG) try { console.debug('kyber.ensureImpl: using cached impl') } catch (e) {}
    return impl
  }
  const native = await loadBundledWasm()
  if (!native) throw new Error('Kyber WASM module not found. Place kyber-bundled.min.js and kyber.wasm under src/lib/kyber-wasm/ per src/lib/kyber-wasm/README_KYBER.md')
  impl = native
  usedNative = true
  if (KYBER_DEBUG) try { console.debug('kyber.ensureImpl: native impl loaded') } catch (e) {}
  return impl
}

export async function generateKeypair() {
  if (KYBER_DEBUG) try { console.debug('kyber.generateKeypair: called') } catch (e) {}
  const m = await ensureImpl()
  const res = await m.generateKeypair()
  if (KYBER_DEBUG) try { console.debug('kyber.generateKeypair: done', { pkLen: res.publicKey?.length, skLen: res.secretKey?.length }) } catch (e) {}
  return res
}

export async function encapsulate(pk: Uint8Array) {
  if (KYBER_DEBUG) try { console.debug('kyber.encapsulate: called', { pkLen: pk?.length }) } catch (e) {}
  const m = await ensureImpl()
  const res = await m.encapsulate(pk)
  if (KYBER_DEBUG) try { console.debug('kyber.encapsulate: done', { ssLen: res.sharedSecret?.length, ctLen: res.ciphertext?.length }) } catch (e) {}
  return res
}

export async function decapsulate(sk: Uint8Array, ct: Uint8Array) {
  if (KYBER_DEBUG) try { console.debug('kyber.decapsulate: called', { skLen: sk?.length, ctLen: ct?.length }) } catch (e) {}
  const m = await ensureImpl()
  const res = await m.decapsulate(sk, ct)
  if (KYBER_DEBUG) try { console.debug('kyber.decapsulate: done', { ssLen: res?.length }) } catch (e) {}
  return res
}

export default { ensureImpl, generateKeypair, encapsulate, decapsulate }

export function isNativeAvailable() {
  return usedNative
}
