const PIN_LENGTH = 6;
const PBKDF2_ITERATIONS = 210000;
const COMMON_WEAK_PINS = new Set([
  "000000",
  "111111",
  "121212",
  "123123",
  "123456",
  "654321",
  "112233",
]);

function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function isValidPin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

function isAscending(pin) {
  for (let i = 1; i < pin.length; i += 1) {
    if (Number(pin[i]) !== Number(pin[i - 1]) + 1) return false;
  }
  return true;
}

function isDescending(pin) {
  for (let i = 1; i < pin.length; i += 1) {
    if (Number(pin[i]) !== Number(pin[i - 1]) - 1) return false;
  }
  return true;
}

export function getPinStrengthError(pin) {
  const value = String(pin || "");
  if (!isValidPin(value)) {
    return `PIN must be exactly ${PIN_LENGTH} digits`;
  }
  if (COMMON_WEAK_PINS.has(value)) {
    return "PIN is too common. Choose a less predictable PIN.";
  }
  if (/^(\d)\1{5}$/.test(value)) {
    return "PIN cannot be the same digit repeated.";
  }
  if (isAscending(value) || isDescending(value)) {
    return "PIN cannot be a simple sequence.";
  }
  return "";
}

export function isStrongPin(pin) {
  return !getPinStrengthError(pin);
}

async function deriveKeyFromPin(pin, salt) {
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPhraseWithPin(phrase, pin) {
  if (!isValidPin(pin)) {
    throw new Error("PIN must be exactly 6 digits");
  }

  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPin(pin, salt);

  const payload = new TextEncoder().encode(
    JSON.stringify({ phrase: phrase.trim().toLowerCase(), v: 1, ts: Date.now() }),
  );

  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload),
  );

  return {
    version: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    updatedAt: new Date().toISOString(),
  };
}

export async function decryptPhraseWithPin(vault, pin) {
  if (!vault?.salt || !vault?.iv || !vault?.ciphertext) {
    throw new Error("No secure PIN vault found on this device");
  }
  if (!isValidPin(pin)) {
    throw new Error("PIN must be exactly 6 digits");
  }

  const salt = fromB64(vault.salt);
  const iv = fromB64(vault.iv);
  const ciphertext = fromB64(vault.ciphertext);
  const key = await deriveKeyFromPin(pin, salt);

  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  return String(parsed?.phrase || "").trim().toLowerCase();
}

export { PIN_LENGTH };
