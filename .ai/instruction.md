🧠 ZChat — AI Agent Master Instruction (Production Spec)
🎯 Mission

Build a Zero-Knowledge, Bitcoin-grade secure messaging application using:

Frontend: React (latest) + Vite + TailwindCSS
Backend: Supabase (DB + Realtime + Edge Functions)
Crypto Layer: Signal Protocol + Hybrid PQC (X25519 + Kyber-768)
Storage: SQLCipher (encrypted local DB)
Threads: Web Workers for crypto ops

The system must ensure:

❗ No server, attacker, or third party can ever read user data, metadata, or relationships.

the developer pc already have SUPABASE CLI so you can use it to make the backend on your own

🧩 CORE ARCHITECTURE PRINCIPLES
1. 🔐 Zero-Knowledge by Design
Server = blind relay + encrypted storage
Client = all encryption/decryption
Supabase only stores:
Encrypted blobs
Random UUIDs
Public keys
2. 🧬 Identity System (Root of Trust)
🔑 Mnemonic Generation
BIP-39 compliant
User chooses:
12 words OR 24 words
NEVER store:
Phrase
Derived seed
Private keys
🧠 Key Derivation Pipeline
Mnemonic → Argon2id → 512-bit Seed → HKDF → Multiple Keys

Derived keys:

Identity Key (X25519)
Signing Key (Ed25519)
PreKeys (for X3DH)
Encryption Root Key
Auth Token Key
🆔 UUID Strategy (Anti-Tracking)
Use Random UUID v4
NEVER derive UUID from keys
Mapping:
UUID → Public Identity Key
3. 🕵️ Username Privacy
Username encrypted using:
AES-256-GCM
Only decrypted:
After friend request acceptance

Before acceptance:

Users only see:
UUID
No metadata
4. 🤝 Secure Handshake (Edge Layer)
Protocol:
X3DH (Extended Triple Diffie-Hellman)
Upgrade (MANDATORY):
Hybrid:
X25519 (classical)
Kyber-768 (post-quantum)
5. 🔁 Messaging Protocol (Double Ratchet)

Every action = encrypted packet:

Message
Edit
Reaction
Read receipt
Typing indicator
Delete events
Guarantees:
Forward Secrecy
Post-compromise security
New key per message
6. 📦 Metadata Obfuscation

All packets must:

Have uniform size
Be indistinguishable

Server cannot detect:

Who is typing
Who read messages
Message frequency
7. ⚡ Optimistic UI (Critical UX Rule)
Always:
Update UI instantly
Process encryption/network in background

Examples:

Sending message → instantly appears
Deleting → instantly disappears
Reacting → instant feedback
8. 🧵 Background Crypto Execution

Use:

Web Workers

Never block UI thread.

🗄️ DATA & STORAGE MODEL
🔒 Local Database
SQLCipher (AES-256)
Data NEVER stored as plaintext

Unlock conditions:

PIN OR Biometric
🔁 Cache Strategy
Decrypted data cached in memory (NOT disk)
UI reads from cache only
Sync engine updates cache continuously
🔄 Sync Engine
Real-time Supabase subscriptions
Apply:
Insert
Update
Delete
Re-encrypt on outbound
Decrypt on inbound
🧨 DELETE SYSTEM (SHRED LOGIC)
Delete for Me
Local wipe only
Destroy message keys
Irreversible
Delete for Everyone
Send encrypted “SHRED” packet
Client:
Overwrite memory + DB sectors
Server:
Cascade delete:
Messages
Reactions
Metadata
Unfriend
Full cascade wipe:
Chat
Messages
Keys
Metadata
Block
Performs:
Unfriend
Delete chat
Prevent new requests
Delete Account
Full cascade wipe:
Identity
Chats
All records
🔐 NETWORK RULES (CRITICAL)

Every request:

Encrypted
Unique key (ratchet)
Signed

No plaintext ever.

🧾 AUTH FLOW
🆕 Sign Up (3 Steps)
Step 1: Generate Phrase
12/24 toggle
Buttons:
Regenerate
Copy
Warning checkbox:
Required to proceed
Step 2: Verify Phrase
Paste support
Exact validation
Step 3: Username
Encrypt before sending
Send:
UUID
Public keys
Encrypted username
🔑 Sign In

Options:

Manual phrase input
Saved login dropdown
🔒 Remember Me
Stores encrypted private key
Protected by:
PIN
Biometric
📱 MAIN APP FLOW
On Login:
Generate session token
Fetch:
UUID
Encrypted profile
Enter app
Background Fetch:
Chats
Messages
Friends
Requests
Block list
UI always uses:

👉 Local cache (instant rendering)

🎨 UI/UX SYSTEM (MODERN)
📐 Design Requirements
Mobile + Desktop responsive
No emojis → SVG icons only
60 FPS interactions
🎨 Color Palettes
Nordic
Dracula
Gruvbox
Gold Dark
Blue Dark
Green Dark
Flat UI
Mood & Logic
🧊 Materials
Glassmorphism
Neumorphism
Bento Grid
Claymorphism
Solid
🔷 Shapes
Sharp
Soft Rounded
Fully Rounded
Organic
🌍 Localization
RTL:
Arabic
Kurdish
LTR:
English
Use logical CSS:
margin-inline
padding-inline
🧱 BACKEND (SUPABASE)
Responsibilities:
Store encrypted blobs
Manage UUID indexing
Realtime events
Edge Functions:
Relay encrypted packets
NEVER:
Decrypt data
Access usernames
Access messages
⚙️ EDGE FUNCTIONS ROLE
Act as:
Secure relay
Rate limiter
Validate:
Packet format only
🧰 TECH STACK (STRICT)
Frontend:
React (latest)
Vite
TailwindCSS
Crypto:
noble-curves
libp2p
SignalProtocol.js
Storage:
SQLCipher
🚀 PERFORMANCE RULES
Use:
Virtualized lists (chat)
Avoid:
Re-renders
Use:
Memoization
Suspense
Lazy loading
🧪 AI CODING RULES (IMPORTANT)

The AI agent MUST:

1. Build in Modules
Auth module
Crypto module
Messaging module
UI system
2. Always:
Write production-ready code
Use latest APIs
Avoid deprecated patterns
3. Security First:
Validate all inputs
Zero logging of secrets
4. UX First:
No blocking UI
Instant feedback
5. Code Style:
Clean architecture
Reusable hooks/components
Strong typing (TypeScript preferred)
🔥 FINAL DIRECTIVE

This app must behave like a combination of:

Signal (security)
Telegram (UX speed)
iMessage (fluid UI)

But with:
👉 Stronger privacy than all of them combined
