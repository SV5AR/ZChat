#include "kem.h"
#include <emscripten/emscripten.h>
#include <stdlib.h>

EMSCRIPTEN_KEEPALIVE
int PQC_KEYPAIR(unsigned char *pk, unsigned char *sk) {
    return PQCLEAN_MLKEM768_CLEAN_crypto_kem_keypair(pk, sk);
}
EMSCRIPTEN_KEEPALIVE
int PQC_ENCAP(unsigned char *ct, unsigned char *ss, const unsigned char *pk) {
    return PQCLEAN_MLKEM768_CLEAN_crypto_kem_enc(ct, ss, pk);
}
EMSCRIPTEN_KEEPALIVE
int PQC_DECAP(unsigned char *ss, const unsigned char *ct, const unsigned char *sk) {
    return PQCLEAN_MLKEM768_CLEAN_crypto_kem_dec(ss, ct, sk);
}

EMSCRIPTEN_KEEPALIVE
unsigned PQC_PK_BYTES() { return PQCLEAN_MLKEM768_CLEAN_CRYPTO_PUBLICKEYBYTES; }
EMSCRIPTEN_KEEPALIVE
unsigned PQC_SK_BYTES() { return PQCLEAN_MLKEM768_CLEAN_CRYPTO_SECRETKEYBYTES; }
EMSCRIPTEN_KEEPALIVE
unsigned PQC_CT_BYTES() { return PQCLEAN_MLKEM768_CLEAN_CRYPTO_CIPHERTEXTBYTES; }
EMSCRIPTEN_KEEPALIVE
unsigned PQC_SS_BYTES() { return PQCLEAN_MLKEM768_CLEAN_CRYPTO_BYTES; }
