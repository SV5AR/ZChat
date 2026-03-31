Security hardening checklist for Kyber/WASM and ratchet integration

- Verify sources:
  - Confirm `pqclean` commit hash and source provenance used to build the wasm.
  - Keep an immutable copy of the compiler command and flags (see `build-kyber.sh`).

- Emscripten build flags & review:
  - Build with `-O3` and `-s ALLOW_MEMORY_GROWTH=1` for safety if needed.
  - Prefer building with `-s ASSERTIONS=2` in CI debug builds to catch errors.
  - Avoid enabling debug features in production glue.

- API surface & exports:
  - Expose only the minimal C API: `crypto_kem_keypair`, `crypto_kem_enc`, `crypto_kem_dec`.
  - Do not export raw memory helpers beyond what the loader needs.

- Memory hygiene:
  - Zeroize secret buffers (secretKey, sharedSecret) in JS and WASM after use.
  - Avoid long-lived heap allocations for secrets; free memory promptly.

- Constant-time & side-channels:
  - Ensure PQClean clean implementation is used and that compiled code preserves constant-time properties.
  - Avoid JS-side branches that vary on secret data.

- Glue review:
  - Audit emscripten-generated glue for unexpected helpers or filesystem access.
  - Ensure `Module.locateFile` is used so the wasm is loaded from controlled path.

- Testing & CI:
  - Add CI job to verify artifacts and run full test suite (exists in .github/workflows/ci.yml).
  - Add fuzzing and differential tests where practical.

- Operational:
  - Pin emsdk and compiler versions used to build the wasm.
  - Sign or checksum wasm artifacts and verify in CI.

- Runtime telemetry & logging:
  - Log KEM operation start/finish but never log secrets.
  - Rotate and redact logs containing sensitive metadata.

- Documentation:
  - Keep `src/lib/kyber-wasm/README_KYBER.md` updated with build steps and provenance.
