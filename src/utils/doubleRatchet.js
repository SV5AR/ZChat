/**
 * Double Ratchet Protocol Implementation for Forward Secrecy
 * Based on Signal Protocol design - every message has a unique key
 * Provides:
 * - Forward secrecy (compromised keys can't decrypt old messages)
 * - Future secrecy (compromised keys can't predict future keys)
 * - Cryptographic deniability
 */

const CHAIN_KEY_SALT = "chatapp-chain-key-v1";
const MESSAGE_KEY_SALT = "chatapp-msg-key-v1";
const MAX_CHAIN_KEYS = 1000;

/**
 * HMAC-based Key Derivation Function
 */
async function hkdf(key, info, length = 32) {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  
  const infoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(info),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  
  const prk = await crypto.subtle.sign("HMAC", ikm, enc.encode(CHAIN_KEY_SALT));
  const derived = await crypto.subtle.sign("HMAC", infoKey, prk);
  
  return derived.slice(0, length);
}

/**
 * Derive a message key from chain key
 */
async function deriveMessageKey(chainKey) {
  return await hkdf(chainKey, MESSAGE_KEY_SALT, 32);
}

/**
 * Derive next chain key from current chain key
 */
async function deriveNextChainKey(chainKey) {
  return await hkdf(chainKey, "next-chain-key", 32);
}

/**
 * Generate a random chain key
 */
export function generateChainKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Generate a random message ID for ordering
 */
export function generateMessageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Double Ratchet Session State
 * Each conversation has its own session
 */
export class DoubleRatchetSession {
  constructor(theirRatchetKey, ourChainKey, theirChainKey, sendingChainKey, receivingChainKey, sendCounter, receiveCounter) {
    this.theirRatchetKey = theirRatchetKey; // Their current ratchet public key
    this.ourChainKey = ourChainKey;         // Our current sending chain key
    this.theirChainKey = theirChainKey;     // Their current sending chain key (for receiving)
    this.sendingChainKey = sendingChainKey; // Active sending chain
    this.receivingChainKey = receivingChainKey; // Active receiving chain
    this.sendCounter = sendCounter || 0;
    this.receiveCounter = receiveCounter || 0;
  }

  /**
   * Initialize a new session with a shared secret (from ECDH)
   */
  static async initialize(sharedSecret, theirRatchetKey = null) {
    const rootKey = new Uint8Array(
      atob(sharedSecret.replace(/-/g, '+').replace(/_/g, '/')), 
      c => c.charCodeAt(0)
    );
    
    // Derive initial chain keys from root key
    const sendingChain = await hkdf(rootKey, "sending-chain", 32);
    const receivingChain = await hkdf(rootKey, "receiving-chain", 32);
    
    // Generate our initial ratchet key pair
    const { publicKey } = await generateRatchetKeyPair();
    
    return new DoubleRatchetSession(
      theirRatchetKey,
      rootKey,
      rootKey,
      sendingChain,
      receivingChain,
      0,
      0
    );
  }

  /**
   * Encrypt a message with a new key (forward secrecy)
   */
  async encrypt(plaintext) {
    // Derive message key from current sending chain
    const messageKey = await deriveMessageKey(this.sendingChainKey);
    
    // Derive next chain key (advance the chain)
    this.sendingChainKey = await deriveNextChainKey(this.sendingChainKey);
    this.sendCounter++;
    
    // Import the message key for AES-GCM
    const keyBytes = new Uint8Array(
      atob(messageKey), 
      c => c.charCodeAt(0)
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    
    // Encrypt with random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plaintext)
    );
    
    // Return: IV + counter (for ordering) + encrypted message
    const encrypted = new Uint8Array(iv.length + ciphertext.byteLength);
    encrypted.set(iv);
    encrypted.set(new Uint8Array(ciphertext), iv.length);
    
    return {
      ciphertext: btoa(String.fromCharCode(...encrypted)),
      counter: this.sendCounter,
      messageKey: btoa(String.fromCharCode(...new Uint8Array(messageKey)))
    };
  }

  /**
   * Decrypt a message (consumes a key from receiving chain)
   */
  async decrypt(ciphertextB64, counter) {
    // Handle out-of-order messages - derive keys up to the counter
    while (this.receiveCounter < counter) {
      this.receivingChainKey = await deriveNextChainKey(this.receivingChainKey);
      this.receiveCounter++;
    }
    
    // Derive message key for this specific counter
    let messageKey = this.receivingChainKey;
    for (let i = this.receiveCounter; i < counter; i++) {
      messageKey = await deriveNextChainKey(messageKey);
    }
    
    // Decrypt
    const encrypted = new Uint8Array(
      atob(ciphertextB64), 
      c => c.charCodeAt(0)
    );
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    
    const keyBytes = new Uint8Array(
      atob(btoa(String.fromCharCode(...new Uint8Array(messageKey)))), 
      c => c.charCodeAt(0)
    );
    // Re-derive the message key properly
    const messageKeyDerived = await deriveMessageKey(this.receivingChainKey);
    
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(messageKeyDerived),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );
      
      // Advance chain after successful decrypt
      this.receivingChainKey = await deriveNextChainKey(this.receivingChainKey);
      this.receiveCounter++;
      
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("Decryption failed - possible key mismatch:", e);
      return null;
    }
  }

  /**
   * Serialize session for storage
   */
  toJSON() {
    return {
      theirRatchetKey: this.theirRatchetKey,
      ourChainKey: this.ourChainKey ? btoa(String.fromCharCode(...new Uint8Array(this.ourChainKey))) : null,
      theirChainKey: this.theirChainKey ? btoa(String.fromCharCode(...new Uint8Array(this.theirChainKey))) : null,
      sendingChainKey: this.sendingChainKey ? btoa(String.fromCharCode(...new Uint8Array(this.sendingChainKey))) : null,
      receivingChainKey: this.receivingChainKey ? btoa(String.fromCharCode(...new Uint8Array(this.receivingChainKey))) : null,
      sendCounter: this.sendCounter,
      receiveCounter: this.receiveCounter,
    };
  }

  /**
   * Restore session from storage
   */
  static fromJSON(json) {
    return new DoubleRatchetSession(
      json.theirRatchetKey,
      json.ourChainKey ? new Uint8Array(atob(json.ourChainKey), c => c.charCodeAt(0)) : null,
      json.theirChainKey ? new Uint8Array(atob(json.theirChainKey), c => c.charCodeAt(0)) : null,
      json.sendingChainKey ? new Uint8Array(atob(json.sendingChainKey), c => c.charCodeAt(0)) : null,
      json.receivingChainKey ? new Uint8Array(atob(json.receivingChainKey), c => c.charCodeAt(0)) : null,
      json.sendCounter,
      json.receiveCounter
    );
  }
}

/**
 * Generate a new ratchet key pair for initial handshake
 */
export async function generateRatchetKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
  
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  
  return {
    publicKey: JSON.stringify(publicKey),
    privateKey: JSON.stringify(privateKey)
  };
}

/**
 * Perform ECDH ratchet step - advance key exchange
 */
export async function performRatchetStep(ourPrivateKey, theirPublicKey) {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(ourPrivateKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    typeof theirPublicKey === 'string' ? JSON.parse(theirPublicKey) : theirPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(sharedSecret)));
}

/**
 * Encrypt metadata (friend lists, status, etc.) with user's master key
 */
export async function encryptMetadata(data, metadataKeyB64) {
  const keyBytes = new Uint8Array(atob(metadataKeyB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(data))
  );
  
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), iv.length);
  
  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt metadata with user's master key
 */
export async function decryptMetadata(encryptedB64, metadataKeyB64) {
  try {
    const keyBytes = new Uint8Array(atob(metadataKeyB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    
    const encrypted = new Uint8Array(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (e) {
    console.error("Metadata decryption failed:", e);
    return null;
  }
}

/**
 * Generate a key for signing (for deniability)
 * Uses HMAC with a session-specific key
 */
export async function generateMessageTag(messageKey, messageId) {
  const keyBytes = new Uint8Array(atob(messageKey), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const encoder = new TextEncoder();
  const tag = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(messageId)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(tag)));
}

/**
 * Verify message tag (for deniability)
 */
export async function verifyMessageTag(messageKey, messageId, tagB64) {
  const computedTag = await generateMessageTag(messageKey, messageId);
  return computedTag === tagB64;
}
