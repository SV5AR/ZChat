/**
 * Bitcoin BIP39 Phrase Authentication
 * - 12-word mnemonic → seed → master key
 * - Zero-knowledge: phrases never leave device
 * - PBKDF2 hardened key derivation
 */

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { sha256 } from "@noble/hashes/sha256";

const PHRASE_VERSION = 1;
const PBKDF2_ITERATIONS = 500_000;
const PBKDF2_HASH = "SHA-256";

/**
 * Generate cryptographically secure BIP39 phrase.
 * 12 words => 128-bit entropy, 24 words => 256-bit entropy
 */
export function generateSecurePhrase(wordCount = 12) {
  if (wordCount !== 12 && wordCount !== 24) {
    throw new Error("Word count must be 12 or 24");
  }
  const entropyBytes = wordCount === 24 ? 32 : 16;
  const entropy = window.crypto.getRandomValues(new Uint8Array(entropyBytes));
  const mnemonic = bip39.entropyToMnemonic(entropy, wordlist);

  if (!bip39.validateMnemonic(mnemonic, wordlist)) {
    throw new Error("Generated invalid mnemonic");
  }

  return mnemonic;
}

/**
 * Validate phrase format & checksum (BIP39 standard)
 */
export function validatePhrase(phrase) {
  const trimmed = phrase.trim().toLowerCase();
  const words = trimmed.split(/\s+/);

  if (words.length !== 12 && words.length !== 24) return false;
  if (words.some((w) => !wordlist.includes(w))) return false;

  return bip39.validateMnemonic(trimmed, wordlist);
}

/**
 * Derive master key from phrase using BIP39 + hardened PBKDF2
 *
 * BIP39 Flow:
 * 1. Normalize phrase
 * 2. PBKDF2(phrase, salt="mnemonic", 2048) → 512-bit seed
 * 3. Additional app-specific PBKDF2 hardening → 256-bit master key
 */
export async function deriveMasterKeyFromPhrase(phrase) {
  if (!validatePhrase(phrase)) {
    throw new Error("Invalid BIP39 phrase");
  }

  const normalizedPhrase = phrase.trim().toLowerCase();
  const enc = new TextEncoder();

  // Step 1: BIP39 seed generation (standard)
  const phraseBytes = enc.encode(normalizedPhrase);
  const passphraseBytes = enc.encode("mnemonic"); // BIP39 uses "mnemonic" prefix

  const pbkdfKey = await window.crypto.subtle.importKey(
    "raw",
    phraseBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const seedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: passphraseBytes,
      iterations: 2048, // BIP39 standard
      hash: "SHA-512",
    },
    pbkdfKey,
    512, // 64 bytes
  );

  // Step 2: App-specific hardening (additional security layer)
  const appSalt = enc.encode("chatapp-v1-master-key");

  const hardenerKey = await window.crypto.subtle.importKey(
    "raw",
    new Uint8Array(seedBits),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const masterKeyBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: appSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    hardenerKey,
    256, // 32 bytes for AES-256
  );

  // Base64 encode for storage
  return btoa(String.fromCharCode(...new Uint8Array(masterKeyBits)));
}

/**
 * Hash phrase for Supabase lookup
 * Never store raw phrase - only hash
 * Used to link account to phrase for authentication without exposing phrase
 */
export async function hashPhraseForStorage(phrase) {
  if (!validatePhrase(phrase)) {
    throw new Error("Invalid BIP39 phrase");
  }

  const phraseBytes = new TextEncoder().encode(phrase.trim().toLowerCase());
  const hash = sha256(phraseBytes);

  return btoa(String.fromCharCode(...hash));
}

/**
 * Encrypt phrase for local storage (IndexedDB)
 * Master key is derived from phrase itself
 */
export async function encryptPhraseForLocalStorage(phrase, masterKey) {
  const enc = new TextEncoder();
  const data = enc.encode(
    JSON.stringify({
      phrase: phrase.trim().toLowerCase(),
      v: PHRASE_VERSION,
      timestamp: Date.now(),
    }),
  );

  // Derive encryption key from master key for double-protection
  const mkBytes = new Uint8Array(
    atob(masterKey)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );

  const encKey = await window.crypto.subtle.importKey(
    "raw",
    mkBytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("phrase-encryption-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    encKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  // Random IV (nonce)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ct = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    data,
  );

  // Prepend IV to ciphertext
  const output = new Uint8Array(12 + ct.byteLength);
  output.set(iv);
  output.set(new Uint8Array(ct), 12);

  return btoa(String.fromCharCode(...output));
}

/**
 * Decrypt phrase from local storage
 */
export async function decryptPhraseFromLocalStorage(encrypted, masterKey) {
  const enc = new TextEncoder();
  const buf = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);

  // Derive same encryption key
  const mkBytes = new Uint8Array(
    atob(masterKey)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );

  const encKey = await window.crypto.subtle.importKey(
    "raw",
    mkBytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("phrase-encryption-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    encKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const pt = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ct,
  );

  const { phrase } = JSON.parse(new TextDecoder().decode(pt));
  return phrase;
}

/**
 * Derive session key from phrase (for message encryption)
 * Each session gets a unique derived key
 */
export async function deriveSessionKeyFromPhrase(phrase, sessionId) {
  if (!validatePhrase(phrase)) {
    throw new Error("Invalid BIP39 phrase");
  }

  const enc = new TextEncoder();
  const phraseBytes = enc.encode(phrase.trim().toLowerCase());

  const key = await window.crypto.subtle.importKey(
    "raw",
    phraseBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const sessionSalt = enc.encode(`session-${sessionId || "default"}`);

  const sessionKeyBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: sessionSalt,
      iterations: 50_000, // Lighter iteration count for session keys
      hash: "SHA-256",
    },
    key,
    256,
  );

  return btoa(String.fromCharCode(...new Uint8Array(sessionKeyBits)));
}
