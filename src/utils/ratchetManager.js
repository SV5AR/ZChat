import { saveRatchetState, loadRatchetStates } from "../lib/schemaApi";
import { encryptRatchetState, decryptRatchetState } from "./crypto";

const _ratchetCache = {};
const _ratchetLocks = {};
const _ratchetSaveQueues = {};

const DBG = typeof window !== "undefined" && window.__CHAT_DEBUG__ === true;

export function getConversationKey(userId, otherUserId) {
  // Create a deterministic conversation key (sorted to ensure both users generate same key)
  const sorted = [userId, otherUserId].sort();
  return sorted.join(":");
}

export async function initRatchetFromStorage(privateKey) {
  if (!privateKey) return;
  
  try {
    const states = await loadRatchetStates();
    
    for (const state of states || []) {
      try {
        const decrypted = await decryptRatchetState(state.encrypted_state, privateKey);
        if (decrypted) {
          _ratchetCache[state.conversation_key] = decrypted;
        }
      } catch (e) {
        console.warn("Failed to decrypt ratchet state for", state.conversation_key, e);
      }
    }
    
    if (DBG) console.debug("[Ratchet] Loaded", Object.keys(_ratchetCache).length, "conversation states");
  } catch (e) {
    console.warn("Failed to load ratchet states:", e);
  }
}

export async function getRatchetState(conversationKey) {
  return _ratchetCache[conversationKey] || null;
}

export async function createRatchetState(
  myPrivateKeyHex,
  theirPublicKeyHex,
  conversationKey = null,
) {
  // Derive initial chain key from ECDH
  const { deriveSharedKeyNaCl } = await import("./crypto");
  const chainKey = await deriveSharedKeyNaCl(myPrivateKeyHex, theirPublicKeyHex);

  const state = {
    sendingChainKey: chainKey,
    receivingChainKey: chainKey,
    sendingMessageNumber: 0,
    receivingMessageNumber: 0,
    previousChainLength: 0,
  };

  if (conversationKey) {
    _ratchetCache[conversationKey] = state;
    await saveRatchetStateToServer(conversationKey, myPrivateKeyHex);
  }

  return state;
}

async function deriveMessageKey(chainKey, messageNumber) {
  // Derive unique message key from chain key + message number
  const encoder = new TextEncoder();
  const data = encoder.encode(chainKey + ":" + messageNumber);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

async function advanceChainKey(chainKey) {
  // Advance chain key (HMAC-like operation)
  const encoder = new TextEncoder();
  const data = encoder.encode(chainKey + "advance");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function withRatchetLock(conversationKey, fn) {
  const key = String(conversationKey || "");
  if (!key) return fn();
  const prev = _ratchetLocks[key] || Promise.resolve();
  const run = prev.then(fn, fn);
  _ratchetLocks[key] = run.catch(() => {});
  return run;
}

export async function encryptWithRatchet(plaintext, conversationKey, privateKey) {
  return withRatchetLock(conversationKey, async () => {
  let state = _ratchetCache[conversationKey];
  
  if (!state) {
    return null;
  }
  
  const messageNumber = state.sendingMessageNumber;
  const messageKey = await deriveMessageKey(state.sendingChainKey, messageNumber);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    messageKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    plaintextBytes,
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  const ciphertextB64 = btoa(String.fromCharCode(...packed));
  
  // Advance chain key and message number (inside lock)
  state.sendingChainKey = await advanceChainKey(state.sendingChainKey);
  state.sendingMessageNumber++;
  _ratchetCache[conversationKey] = state;
  
  // Save to server inside lock (debounced to avoid spam on rapid sends)
  await saveRatchetStateToServer(conversationKey, privateKey);

  return {
    ciphertext: ciphertextB64,
    messageNumber,
  };
  });
}

export async function decryptWithRatchet(ciphertext, conversationKey, privateKey, messageNumber = null) {
  return withRatchetLock(conversationKey, async () => {
  let state = _ratchetCache[conversationKey];
  
  if (!state) {
    return null;
  }
  
  const targetNumber =
    Number.isInteger(messageNumber) && messageNumber >= 0
      ? messageNumber
      : state.receivingMessageNumber;

  // Monotonic guard: skip if already processed
  if (targetNumber < state.receivingMessageNumber) {
    return null;
  }

  // Advance receiving chain to the target message number
  while (state.receivingMessageNumber < targetNumber) {
    state.receivingChainKey = await advanceChainKey(state.receivingChainKey);
    state.receivingMessageNumber++;
  }

  const messageKey = await deriveMessageKey(state.receivingChainKey, state.receivingMessageNumber);

  const packed = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = packed.slice(0, 12);
  const encrypted = packed.slice(12);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    messageKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encrypted,
  );
  const plaintextStr = new TextDecoder().decode(decrypted);
  
  // Advance chain key and message number (inside lock)
  state.receivingChainKey = await advanceChainKey(state.receivingChainKey);
  state.receivingMessageNumber++;
  _ratchetCache[conversationKey] = state;
  
  // Save to server inside lock (debounced to avoid spam on rapid receives)
  await saveRatchetStateToServer(conversationKey, privateKey);

  return plaintextStr;
  });
}

async function saveRatchetStateToServer(conversationKey, privateKey) {
  try {
    const key = String(conversationKey || "");
    if (!_ratchetSaveQueues[key]) {
      _ratchetSaveQueues[key] = Promise.resolve();
    }
    
    const prev = _ratchetSaveQueues[key];
    const run = prev.then(async () => {
      const state = _ratchetCache[conversationKey];
      if (!state || !privateKey) return;
      const encrypted = await encryptRatchetState(state, privateKey);
      if (encrypted) {
        await saveRatchetState(conversationKey, encrypted);
      }
    }).catch(() => {});
    _ratchetSaveQueues[key] = run;
    
    // Await to ensure state is persisted before caller continues
    await run;
  } catch (e) {
    console.warn("Failed to save ratchet state:", e);
  }
}

// Export save queue for external flushing (e.g. when closing chat)
export function flushRatchetSaveQueue(conversationKey) {
  const key = String(conversationKey || "");
  return _ratchetSaveQueues[key] || Promise.resolve();
}

export function clearRatchetCache() {
  Object.keys(_ratchetCache).forEach((key) => delete _ratchetCache[key]);
}

// DEV helper: expose ratchet cache for debugging when DBG is enabled
if (typeof window !== "undefined") {
  try {
    Object.defineProperty(window, "__getRatchetStates__", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: function () {
        return DBG ? JSON.parse(JSON.stringify(_ratchetCache || {})) : null;
      },
    });
  } catch (e) {
    // ignore if environment disallows
  }
}
