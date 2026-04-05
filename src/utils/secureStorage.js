/**
 * Secure storage helper.
 * Uses in-memory cache + persistent localStorage so saved login/PIN vault survive refresh.
 */

const sessionStore = new Map();

const MK_SESSION_KEY = "__root_private_key_hex_session_v1__";
const SK_SESSION_KEY = "__sk_session_v1__";
const ROOT_KEY_PREFIX = "root_key_";

function readPersisted(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writePersisted(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function removePersisted(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function getValue(key) {
  if (sessionStore.has(key)) return sessionStore.get(key);
  const persisted = readPersisted(key);
  if (persisted !== null) {
    sessionStore.set(key, persisted);
    return persisted;
  }
  return null;
}

function setValue(key, value) {
  sessionStore.set(key, value);
  writePersisted(key, value);
}

function deleteValue(key) {
  sessionStore.delete(key);
  removePersisted(key);
}

function normalizeVaultUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

function accountVaultKey(userId) {
  return `pin_vault_${normalizeVaultUserId(userId)}`;
}

export async function initSecureStorage() {
  return;
}

export async function saveEncryptedPhrase(encryptedPhrase) {
  setValue("encrypted_phrase", encryptedPhrase);
}

export async function loadEncryptedPhrase() {
  return getValue("encrypted_phrase");
}

export async function clearEncryptedPhrase() {
  deleteValue("encrypted_phrase");
}

/**
 * Clear ONLY session data (RAM + sessionStorage).
 * Preserves persistent "Remember Me" data (PIN vault, root keys, accounts)
 * so the user can log back in without re-entering their phrase.
 */
export async function clearSessionOnly() {
  sessionStore.clear();
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
}

/**
 * Clear ALL secure storage including persistent "Remember Me" data.
 * Use this only for "Delete Account" or "Factory Reset" actions.
 */
export async function clearSecureStorage() {
  sessionStore.clear();
  try {
    sessionStorage.clear();
    Object.keys(localStorage)
      .filter(
        (k) =>
          k === "encrypted_phrase" ||
          k === "pin_vault" ||
          k === "ecdh_keys" ||
          k.startsWith("pin_vault_") ||
          k.startsWith("account_") ||
          k.startsWith("root_key_"),
      )
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/**
 * Clear only the current user's cached messages/reactions from localStorage.
 * Does NOT touch keys, PIN vaults, or other accounts.
 */
export async function clearUserCache(userId) {
  const uid = String(userId || "").trim().toLowerCase();
  if (!uid) return;
  try {
    Object.keys(localStorage)
      .filter(
        (k) =>
          k.startsWith(`sc_cache_v1_conv_msgs_${uid}_`) ||
          k.startsWith(`sc_cache_v1_conv_reactions_${uid}_`),
      )
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export async function savePinVault(pinVault) {
  setValue("pin_vault", pinVault);
}

export async function loadPinVault() {
  return getValue("pin_vault");
}

export async function clearPinVault() {
  deleteValue("pin_vault");
}

export async function savePinVaultForUser(userId, pinVault, username = null) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) throw new Error("Missing user id for PIN vault save");
  setValue(accountVaultKey(uid), {
    userId: uid,
    vault: pinVault,
    username,
    timestamp: Date.now(),
  });
}

export async function loadPinVaultForUser(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return null;
  return getValue(accountVaultKey(uid))?.vault || null;
}

export async function hasPinVaultForUser(userId) {
  return !!(await loadPinVaultForUser(userId));
}

export async function clearPinVaultForUser(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return;
  deleteValue(accountVaultKey(uid));
}

export async function listPinVaultAccounts() {
  const map = new Map();
  const accounts = [];
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("pin_vault_"))
      .forEach((k) => {
        const v = readPersisted(k);
        if (v?.userId) map.set(v.userId, v);
      });
  } catch {
    // ignore
  }
  for (const [key, value] of sessionStore.entries()) {
    if (!key.startsWith("pin_vault_") || !value?.userId) continue;
    map.set(value.userId, value);
  }
  for (const value of map.values()) {
    accounts.push({
      userId: value.userId,
      timestamp: Number(value.timestamp) || 0,
    });
  }
  return accounts.sort((a, b) => b.timestamp - a.timestamp);
}

export async function listPinVaultEntries() {
  const map = new Map();
  const entries = [];
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("pin_vault_"))
      .forEach((k) => {
        const v = readPersisted(k);
        if (v?.userId && v?.vault) map.set(v.userId, v);
      });
  } catch {
    // ignore
  }
  for (const [key, value] of sessionStore.entries()) {
    if (!key.startsWith("pin_vault_") || !value?.userId || !value?.vault) continue;
    map.set(value.userId, value);
  }
  for (const value of map.values()) {
    entries.push({
      userId: value.userId,
      vault: value.vault,
      username: value.username || null,
      timestamp: Number(value.timestamp) || 0,
    });
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveAccount(accountData) {
  const uid = normalizeVaultUserId(accountData?.userId);
  if (!uid) throw new Error("Missing user id for account save");
  setValue(`account_${uid}`, {
    userId: uid,
    username: accountData.username || null,
    publicKey: accountData.publicKey || null,
    timestamp: Date.now(),
  });
}

export async function listAccounts() {
  const map = new Map();
  const accounts = [];
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("account_"))
      .forEach((k) => {
        const v = readPersisted(k);
        if (v?.userId) map.set(v.userId, v);
      });
  } catch {
    // ignore
  }
  for (const [key, value] of sessionStore.entries()) {
    if (!key.startsWith("account_") || !value?.userId) continue;
    map.set(value.userId, value);
  }
  for (const value of map.values()) {
    accounts.push({
      userId: value.userId,
      username: value.username || null,
      publicKey: value.publicKey || null,
      timestamp: Number(value.timestamp) || 0,
    });
  }
  return accounts.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getAccount(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return null;
  return getValue(`account_${uid}`) || null;
}

export async function removeAccount(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return;
  await clearPinVaultForUser(uid);
  await clearRootKeyForUser(uid);
  deleteValue(`account_${uid}`);
}

export async function saveRootKeyForUser(userId, privateKeyHex) {
  const uid = normalizeVaultUserId(userId);
  const key = String(privateKeyHex || "").trim().toLowerCase();
  if (!uid) throw new Error("Missing user id for root key save");
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error("Invalid private key format");
  }
  setValue(`${ROOT_KEY_PREFIX}${uid}`, {
    userId: uid,
    mode: "plain",
    privateKey: key,
    timestamp: Date.now(),
  });
}

export async function markRootKeyEncryptedForUser(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) throw new Error("Missing user id for root key mode update");
  setValue(`${ROOT_KEY_PREFIX}${uid}`, {
    userId: uid,
    mode: "pin_vault",
    privateKey: null,
    timestamp: Date.now(),
  });
}

export async function loadRootKeyForUser(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return null;
  const row = getValue(`${ROOT_KEY_PREFIX}${uid}`);
  if (String(row?.mode || "") === "pin_vault") return null;
  const key = String(row?.privateKey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(key)) return null;
  return key;
}

export async function clearRootKeyForUser(userId) {
  const uid = normalizeVaultUserId(userId);
  if (!uid) return;
  deleteValue(`${ROOT_KEY_PREFIX}${uid}`);
}

export function saveRootPrivateKeyHexToSession(rootPrivateKeyHex) {
  try {
    sessionStorage.setItem(MK_SESSION_KEY, rootPrivateKeyHex);
  } catch {
    // Ignore
  }
}

export function loadRootPrivateKeyHexFromSession() {
  try {
    return sessionStorage.getItem(MK_SESSION_KEY) || null;
  } catch {
    return null;
  }
}

export function clearRootPrivateKeyHexFromSession() {
  try {
    sessionStorage.removeItem(MK_SESSION_KEY);
    sessionStorage.removeItem(SK_SESSION_KEY);
  } catch {
    // Ignore
  }
}

export async function saveECDHKeys(publicKeyJwk, encryptedPrivateKeyB64) {
  setValue("ecdh_keys", {
    publicKeyJwk,
    encryptedPrivateKeyB64,
  });
}

export async function loadECDHKeys() {
  return getValue("ecdh_keys") || null;
}
