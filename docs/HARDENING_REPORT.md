# ZChat Backend Hardening Report

This report maps the ZChat instruction.md to the implemented backend hardening controls.

1) Identity & Key Generation
- Mnemonic handling & Argon2/HKDF: client responsibility; server never stores mnemonic.
- Blind UUID: server stores random v4 UUID mapping to public_identity_key in `users`.

2) Stealth Connection & Metadata
- Usernames stored encrypted in `users.encrypted_username` (ciphertext + iv + tag).
- All actions are stored as uniform encrypted packets in `messages` with `packet_size` enforced.

3) Messaging & Double Ratchet
- Server provides prekey consumption, storage, and one-time prekey marking; Double Ratchet occurs client-side.

4) Shred Logic
- `shred-message` and `shred-conversation` functions perform cascade deletes and require Ed25519 signatures.

5) Local Storage & Performance
- Client-side: recommended SQLCipher and Web Worker patterns documented in frontend tasks.

6) Authentication & UI/UX
- Login uses JWTs; `lib/auth.ts` verifies tokens and checks `token_revocations`.

7) Operational Controls
- RLS enabled on sensitive tables; policies enforce access via JWT and membership.
- Audit logs immutable, archived after 1 year.
- Internal function HMAC signing and rotation.
