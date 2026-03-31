#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ./emsdk/emsdk_env.sh ]; then
  echo "emsdk not found in workspace. Please install emsdk or vendor prebuilt artifacts."
  exit 1
fi

echo "Sourcing emsdk environment..."
source ./emsdk/emsdk_env.sh

echo "Building Kyber (PQClean ml-kem-768 clean) -> src/lib/kyber-wasm/"
emcc -O3 -I pqclean/common \
  -s MODULARIZE=1 -s 'EXPORT_NAME="createKyberModule"' \
  -s 'EXPORTED_RUNTIME_METHODS=["cwrap","HEAPU8"]' \
  -s 'EXPORTED_FUNCTIONS=["_PQCLEAN_MLKEM768_CLEAN_crypto_kem_keypair","_PQCLEAN_MLKEM768_CLEAN_crypto_kem_enc","_PQCLEAN_MLKEM768_CLEAN_crypto_kem_dec","_malloc","_free","_kyber_zero"]' \
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
  pqclean/common/*.c \
  wasm_helpers/kyber_zero.c

# Create kyber.wasm path expected by loader
if [ -f src/lib/kyber-wasm/kyber-bundled.min.wasm ]; then
  cp src/lib/kyber-wasm/kyber-bundled.min.wasm src/lib/kyber-wasm/kyber.wasm
fi

echo "Build complete. Artifacts in src/lib/kyber-wasm/"
