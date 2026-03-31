Kyber WASM integration
======================

This folder should contain the Kyber WASM glue JS and the emitted wasm
binary. The loader `src/lib/kyber.ts` expects the following two files here:

- `kyber-bundled.min.js` — the UMD/ESM-compatible glue that exposes
  `generateKeypair()`, `encapsulate(pk)`, and `decapsulate(sk, ct)`.
- `kyber.wasm` — the WebAssembly binary referenced by the glue.

How to obtain/build
-------------------

1. Upstream sources
   - Recommended: use a vetted PQClean or liboqs-derived Kyber WASM build.
   - Example sources: PQClean Kyber (C reference) or liboqs's Kyber

2. Build steps (summary)
   - Build a wasm module exposing the KEM API.
   - Provide a small JS glue that exports `generateKeypair`, `encapsulate`,
     `decapsulate`. The glue should use `Module.locateFile` to find the wasm
     asset (our loader sets that before importing the glue).

3. Place artifacts
   - Copy the resulting `kyber-bundled.min.js` and `kyber.wasm` into this
     folder (`src/lib/kyber-wasm/`).

Notes
-----
- This project intentionally refuses to use a lower-security fallback.
  Tests that require native Kyber will fail until these artifacts are
  provided.
- If you want me to attempt to fetch/build Kyber from a public repo,
  provide the upstream git URL and confirm I may run network operations
  (clone/build) in this environment.

Build command I used (reproducible)
-------------------------------

Source: PQClean `crypto_kem/ml-kem-768/clean` + `pqclean/common` were compiled
with Emscripten. From the workspace root, with `emsdk` available, I ran:

```bash
source ./emsdk/emsdk_env.sh
emcc -O3 -I pqclean/common \
  -s MODULARIZE=1 -s 'EXPORT_NAME="createKyberModule"' \
  -s 'EXPORTED_RUNTIME_METHODS=["cwrap","HEAPU8"]' \
  -s 'EXPORTED_FUNCTIONS=["_PQCLEAN_MLKEM768_CLEAN_crypto_kem_keypair","_PQCLEAN_MLKEM768_CLEAN_crypto_kem_enc","_PQCLEAN_MLKEM768_CLEAN_crypto_kem_dec","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 -s WASM=1 -s NO_EXIT_RUNTIME=1 \
  -o src/lib/kyber-wasm/kyber-bundled.min.js \
  pqclean/crypto_kem/ml-kem-768/clean/kem.c \
  pqclean/crypto_kem/ml-kem-768/clean/indcpa.c \
  pqclean/crypto_kem/ml-kem-768/clean/poly.c \
  pqclean/crypto_kem/ml-kem-768/clean/polyvec.c \
  pqclean/crypto_kem/ml-kem-768/clean/ntt.c \
  pqclean/crypto_kem/ml-kem-768/clean/reduce.c \
  pqclean/crypto_kem/ml-kem-768/clean/symmetric-shake.c \
  pqclean/crypto_kem/ml-kem-768/clean/verify.c \
  pqclean/crypto_kem/ml-kem-768/clean/cbd.c \
  pqclean/common/*.c
```

This produced `kyber-bundled.min.js` and `kyber-bundled.min.wasm` in this
folder. I then copied/renamed the wasm to `kyber.wasm` for the loader.

If you'd like, I can add a small `build-kyber.sh` script and a CI job
that verifies the artifacts and fails the build if they are missing.
