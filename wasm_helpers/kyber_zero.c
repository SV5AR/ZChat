// Minimal helper to securely zero memory from WASM/C side.
#include <stddef.h>

// Provide a volatile write loop to avoid compiler optimizing the wipe away.
void kyber_zero(void *p, size_t n) {
    volatile unsigned char *q = (volatile unsigned char *)p;
    while (n--) {
        *q++ = 0;
    }
}
