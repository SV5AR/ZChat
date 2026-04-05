// ── Encrypted persistent cache ────────────────────────────────────────────────
// Encrypts data with AES-GCM using a key derived from rootPrivateKeyHex before storing
// in localStorage. Decrypts on read. Secure: raw cache is useless without key.

const CACHE_PREFIX = "sc_cache_v1_";

function readRaw(key) {
  try {
    const local = localStorage.getItem(CACHE_PREFIX + key);
    if (local) return local;
  } catch {
    // ignore
  }
  try {
    return sessionStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, value);
  } catch {
    // ignore
  }
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, value);
  } catch {
    // ignore
  }
}

function removeRaw(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // ignore
  }
}

function clearAllRaw() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

function clearByPrefixRaw(prefix) {
  const fullPrefix = CACHE_PREFIX + String(prefix || "");
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(fullPrefix))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(fullPrefix))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

async function deriveCacheKey(rootPrivateKeyHex) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw", enc.encode(rootPrivateKeyHex), "PBKDF2", false, ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("securechat_cache_salt"), iterations: 1000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function cacheSet(rootPrivateKeyHex, key, value) {
  try {
    const cacheKey = await deriveCacheKey(rootPrivateKeyHex);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(value));
    const ct = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cacheKey, data);
    const packed = JSON.stringify({
      iv: Array.from(iv),
      ct: Array.from(new Uint8Array(ct)),
    });
    writeRaw(key, packed);
  } catch (err) {
    console.warn("cacheSet error:", err);
  }
}

export async function cacheGet(rootPrivateKeyHex, key) {
  try {
    const raw = readRaw(key);
    if (!raw) return null;
    const { iv, ct } = JSON.parse(raw);
    const cacheKey = await deriveCacheKey(rootPrivateKeyHex);
    const dec = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      cacheKey, new Uint8Array(ct)
    );
    return JSON.parse(new TextDecoder().decode(dec));
  } catch { return null; }
}

export function cacheClear(key) {
  if (key) removeRaw(key);
  else clearAllRaw();
}

export function cacheClearByPrefix(prefix) {
  clearByPrefixRaw(prefix);
}
