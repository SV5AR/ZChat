import nacl from "tweetnacl";
import { deriveAesKeyFromPrivateKey } from "./zchatIdentity";

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex input");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function assertPrivateKeyHex(privateKeyHex) {
  const clean = String(privateKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("Invalid private key format");
  }
  return clean;
}

export { assertPrivateKeyHex };

async function derivePurposeKeyBytes(privateKeyHex, purpose) {
  const clean = assertPrivateKeyHex(privateKeyHex);
  const label = String(purpose || "general").trim().toLowerCase();
  const input = new TextEncoder().encode(`zchat:${label}:${clean}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(digest);
}

export async function derivePurposeKeyB64(privateKeyHex, purpose) {
  return bytesToB64(await derivePurposeKeyBytes(privateKeyHex, purpose));
}

export async function deriveAesKeyFromPrivateKeyPurpose(privateKeyHex, purpose) {
  const keyBytes = await derivePurposeKeyBytes(privateKeyHex, purpose);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveAESKeyFromPassword(password, purpose = "generic") {
  const material = String(password || "").trim().toLowerCase();
  if (!material) {
    throw new Error("Missing derivation material");
  }
  const input = new TextEncoder().encode(`zchat:${purpose}:${material}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(digest),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithKey(plaintext, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(String(plaintext || "")),
  );
  const packed = new Uint8Array(iv.length + encrypted.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(encrypted), iv.length);
  return bytesToB64(packed);
}

export async function decryptWithKey(cipherB64, aesKey) {
  const packed = b64ToBytes(String(cipherB64 || ""));
  const iv = packed.slice(0, 12);
  const encrypted = packed.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

const _sessionSecureCache = new Map();
const _secureCachePrefix = "zchat_secure_";

function _loadFromDisk(key) {
  try {
    const raw = localStorage.getItem(_secureCachePrefix + key);
    return raw || null;
  } catch {
    return null;
  }
}

function _saveToDisk(key, value) {
  try {
    localStorage.setItem(_secureCachePrefix + key, value);
  } catch {
    // Ignore disk errors
  }
}

function _removeFromDisk(key) {
  try {
    localStorage.removeItem(_secureCachePrefix + key);
  } catch {
    // Ignore
  }
}

export async function loadSecureCacheFromDisk() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(_secureCachePrefix));
    for (const fullKey of keys) {
      const key = fullKey.replace(_secureCachePrefix, "");
      const encrypted = _loadFromDisk(key);
      if (encrypted) {
        _sessionSecureCache.set(key, encrypted);
      }
    }
    console.log("[SecureCache] Loaded from disk, keys:", _sessionSecureCache.size);
  } catch (e) {
    console.warn("[SecureCache] Failed to load from disk:", e);
  }
}

async function getLocalCacheKey() {
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  if (/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
    return deriveAesKeyFromPrivateKeyPurpose(privateKeyHex, "local-cache");
  }
  throw new Error("No local encryption secret found");
}

export async function secureSetItem(key, data) {
  if (!key) return;
  const aesKey = await getLocalCacheKey();
  const encrypted = await encryptWithKey(JSON.stringify(data), aesKey);
  _sessionSecureCache.set(String(key), encrypted);
  _saveToDisk(key, encrypted);
}

export async function secureGetItem(key) {
  if (!key) return null;
  let encrypted = _sessionSecureCache.get(String(key));
  if (!encrypted) {
    encrypted = _loadFromDisk(key);
    if (encrypted) {
      _sessionSecureCache.set(String(key), encrypted);
    }
  }
  if (!encrypted) return null;
  try {
    const aesKey = await getLocalCacheKey();
    const raw = await decryptWithKey(encrypted, aesKey);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function secureRemoveItem(key) {
  if (!key) return;
  _sessionSecureCache.delete(String(key));
  _removeFromDisk(key);
}

export async function secureClearAll() {
  _sessionSecureCache.clear();
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(_secureCachePrefix));
    for (const fullKey of keys) {
      localStorage.removeItem(fullKey);
    }
  } catch {
    // Ignore
  }
}

export async function saveEncryptedMessagesCache(convId, messages) {
  // Message caches are not secrets and should live in the general encrypted cache.
  // Keep this helper for compatibility but forward to cache.js to store per-root-key.
  try {
    const { cacheSet } = await import("./cache");
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    const userId = sessionStorage.getItem("userId") || "";
    const key = `conv_msgs_${String(userId).trim().toLowerCase()}_${convId}`;
    if (/^[0-9a-f]{64}$/i.test(rootKey)) {
      await cacheSet(rootKey, key, messages);
    }
  } catch (e) {
    // Fallback: store in secure store as last resort (shouldn't happen)
    const all = (await secureGetItem("msg_cache")) || {};
    all[convId] = messages;
    await secureSetItem("msg_cache", all);
  }
}

export async function getEncryptedMessagesCache(convId) {
  try {
    const { cacheGet } = await import("./cache");
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    const userId = sessionStorage.getItem("userId") || "";
    const key = `conv_msgs_${String(userId).trim().toLowerCase()}_${convId}`;
    if (/^[0-9a-f]{64}$/i.test(rootKey)) {
      const v = await cacheGet(rootKey, key);
      if (Array.isArray(v)) return v;
    }
  } catch (e) {
    // ignore
  }
  const all = (await secureGetItem("msg_cache")) || {};
  return all[convId] || [];
}

export function loadMasterKeyFromSession() {
  try {
    // Legacy API - in current architecture we keep private key in sessionStorage
    const pk = sessionStorage.getItem("userPrivateKey") || null;
    return pk;
  } catch {
    return null;
  }
}

export function clearMasterKeyFromSession() {
  try {
    // Legacy API alias for private key cleanup
    sessionStorage.removeItem("userPrivateKey");
  } catch {
    // ignore
  }
}

function normalizeX25519PrivateKeyBytes(keyInput) {
  if (keyInput instanceof Uint8Array) {
    if (keyInput.length !== 32) throw new Error("Invalid private key length");
    return keyInput;
  }

  if (Array.isArray(keyInput)) {
    const bytes = Uint8Array.from(keyInput);
    if (bytes.length !== 32) throw new Error("Invalid private key length");
    return bytes;
  }

  if (typeof keyInput === "string") {
    return hexToBytes(assertPrivateKeyHex(keyInput));
  }

  if (keyInput && typeof keyInput === "object") {
    return normalizeX25519PrivateKeyBytes(
      keyInput.privateKeyHex || keyInput.privateKey || keyInput.key,
    );
  }

  throw new Error("Missing private key");
}

function normalizeX25519PublicKeyBytes(keyInput) {
  if (keyInput instanceof Uint8Array) {
    if (keyInput.length !== 32) throw new Error("Invalid public key length");
    return keyInput;
  }

  if (Array.isArray(keyInput)) {
    const bytes = Uint8Array.from(keyInput);
    if (bytes.length !== 32) throw new Error("Invalid public key length");
    return bytes;
  }

  if (typeof keyInput === "string") {
    const clean = String(keyInput).trim().toLowerCase();
    const bytes = hexToBytes(clean);
    if (bytes.length !== 32) throw new Error("Invalid public key length");
    return bytes;
  }

  if (keyInput && typeof keyInput === "object") {
    return normalizeX25519PublicKeyBytes(
      keyInput.publicKeyHex || keyInput.publicKey || keyInput.key,
    );
  }

  throw new Error("Missing public key");
}

export async function importEncryptedPrivateKey(encryptedValue, masterKeyHex) {
  const asString = String(encryptedValue || "").trim();
  if (/^[0-9a-f]{64}$/i.test(asString)) {
    return asString.toLowerCase();
  }

  const aesKey = await deriveAESKeyFromMasterKey(masterKeyHex);
  const decrypted = await decryptWithKey(asString, aesKey);
  return assertPrivateKeyHex(decrypted);
}

export async function deriveAESKeyFromMasterKey(masterKeyHex) {
  // In current version, master key is now private key for proof-of-concept compatibility.
  if (!masterKeyHex) throw new Error("Missing key");
  return deriveAesKeyFromPrivateKey(masterKeyHex);
}

export async function clearEncryptedMessagesCache(convId) {
  try {
    const { cacheGet, cacheSet } = await import("./cache");
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    const userId = sessionStorage.getItem("userId") || "";
    const key = `conv_msgs_${String(userId).trim().toLowerCase()}_${convId}`;
    if (/^[0-9a-f]{64}$/i.test(rootKey)) {
      await cacheSet(rootKey, key, []);
      return;
    }
  } catch (e) {
    // ignore
  }
  const all = (await secureGetItem("msg_cache")) || {};
  delete all[convId];
  await secureSetItem("msg_cache", all);
}

export async function deriveSharedKeyNaCl(myPrivateKeyHex, theirPublicKeyHex) {
  try {
    const myPrivate = hexToBytes(assertPrivateKeyHex(myPrivateKeyHex));
    const theirPublicHex = String(theirPublicKeyHex || "").trim().toLowerCase();
    const theirPublic = hexToBytes(theirPublicHex);
    if (theirPublic.length !== 32) {
      throw new Error("Invalid public key format");
    }
    return bytesToHex(nacl.box.before(theirPublic, myPrivate));
  } catch (e) {
    console.error("deriveSharedKeyNaCl error:", e);
    return null;
  }
}

export async function encryptWithECDH(
  plaintext,
  myPrivateKeyInput,
  theirPublicKeyInput,
) {
  try {
    const myPrivate = normalizeX25519PrivateKeyBytes(myPrivateKeyInput);
    const theirPublic = normalizeX25519PublicKeyBytes(theirPublicKeyInput);
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const payload = new TextEncoder().encode(String(plaintext || ""));
    const cipher = nacl.box(payload, nonce, theirPublic, myPrivate);
    const packed = new Uint8Array(nonce.length + cipher.length);
    packed.set(nonce, 0);
    packed.set(cipher, nonce.length);
    return bytesToB64(packed);
  } catch (e) {
    console.error("encryptWithECDH error:", e);
    return null;
  }
}

export async function decryptWithECDH(
  cipherB64,
  myPrivateKeyInput,
  theirPublicKeyInput,
) {
  try {
    const myPrivate = normalizeX25519PrivateKeyBytes(myPrivateKeyInput);
    const theirPublic = normalizeX25519PublicKeyBytes(theirPublicKeyInput);
    const packed = b64ToBytes(String(cipherB64 || ""));
    const nonce = packed.slice(0, 24);
    const cipher = packed.slice(24);
    const opened = nacl.box.open(cipher, nonce, theirPublic, myPrivate);
    return opened ? new TextDecoder().decode(opened) : null;
  } catch (e) {
    console.error("decryptWithECDH error:", e);
    return null;
  }
}

export async function encryptWithNaCl(plaintext, sharedKeyHex) {
  try {
    const key = hexToBytes(String(sharedKeyHex || "").trim().toLowerCase());
    if (key.length !== 32) throw new Error("Invalid shared key length");
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const msg = new TextEncoder().encode(String(plaintext || ""));
    const cipher = nacl.secretbox(msg, nonce, key);
    const packed = new Uint8Array(nonce.length + cipher.length);
    packed.set(nonce, 0);
    packed.set(cipher, nonce.length);
    return bytesToB64(packed);
  } catch (e) {
    console.error("encryptWithNaCl error:", e);
    return null;
  }
}

export async function decryptWithNaCl(ciphertextB64, sharedKeyHex) {
  try {
    const key = hexToBytes(String(sharedKeyHex || "").trim().toLowerCase());
    if (key.length !== 32) throw new Error("Invalid shared key length");
    const packed = b64ToBytes(String(ciphertextB64 || ""));
    const nonce = packed.slice(0, 24);
    const cipher = packed.slice(24);
    const plain = nacl.secretbox.open(cipher, nonce, key);
    return plain ? new TextDecoder().decode(plain) : null;
  } catch (e) {
    console.error("decryptWithNaCl error:", e);
    return null;
  }
}

export async function encryptRatchetState(state, privateKeyHex) {
  try {
    const key = await deriveAesKeyFromPrivateKeyPurpose(
      privateKeyHex,
      "ratchet-state-encryption",
    );
    return encryptWithKey(JSON.stringify(state), key);
  } catch (e) {
    console.error("encryptRatchetState error:", e);
    return null;
  }
}

export async function decryptRatchetState(encryptedState, privateKeyHex) {
  try {
    const key = await deriveAesKeyFromPrivateKeyPurpose(
      privateKeyHex,
      "ratchet-state-encryption",
    );
    const raw = await decryptWithKey(encryptedState, key);
    return JSON.parse(raw);
  } catch (e) {
    console.error("decryptRatchetState error:", e);
    return null;
  }
}
