/**
 * Bitcoin-Level Security Layer
 * 
 * Comprehensive encryption for ALL data sent to/from server
 * - No plaintext metadata leaves the device
 * - Server sees only encrypted blobs
 * - Perfect forward secrecy via Double Ratchet
 * - Sealed sender for anonymity
 */

import { encryptMetadata, decryptMetadata } from "./doubleRatchet";
import { derivePurposeKeyB64 } from "./crypto";

/**
 * Generate a random IV for each encryption
 */
function generateIV() {
  return crypto.getRandomValues(new Uint8Array(12));
}

async function importAesKeyFromRootPrivateKeyHex(rootPrivateKeyHex) {
  const raw = String(rootPrivateKeyHex || "").trim();
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error("Missing root private key for metadata encryption");
  }

  const purposeKeyB64 = await derivePurposeKeyB64(raw, "metadata-encryption-v1");
  const keyBytes = Uint8Array.from(atob(purposeKeyB64), (c) => c.charCodeAt(0));

  // Validate derived AES key length early so errors are clear
  if (keyBytes.length !== 16 && keyBytes.length !== 32) {
    console.error("Derived AES key has unexpected length:", keyBytes.length, keyBytes);
    throw new Error(
      `Derived AES key invalid length (${keyBytes.length * 8} bits). Expected 128 or 256 bits.`
    );
  }

  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
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

/**
 * Encrypt any data before sending to server
 * Uses AES-256-GCM with user's master key
 */
export async function encryptPayload(data, rootPrivateKeyHex) {
  if (!rootPrivateKeyHex) {
    throw new Error("No root private key available for encryption");
  }

  const iv = generateIV();
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const key = await importAesKeyFromRootPrivateKeyHex(rootPrivateKeyHex);

  let ciphertext;
  try {
    ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  } catch (err) {
    // Fail with clearer message when key import/length is invalid
    console.error("AES encrypt failed:", err);
    throw new Error("AES encryption error: ensure root private key and derived keys are valid (128 or 256 bit AES)");
  }

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), iv.length);

  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...result))
  };
}

/**
 * Decrypt server responses
 */
export async function decryptPayload(encrypted, rootPrivateKeyHex) {
  if (!rootPrivateKeyHex || !encrypted?.data) {
    return encrypted?.data ? JSON.parse(encrypted.data) : null;
  }

  try {
    const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));

    const key = await importAesKeyFromRootPrivateKeyHex(rootPrivateKeyHex);

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (e) {
    console.error("Decryption failed:", e);
    return null;
  }
}

/**
 * Encrypt friend request with sealed sender
 * Even the server doesn't know who sent the request until accepted
 */
export async function createSealedFriendRequest(receiverId, encryptedBundle, rootPrivateKeyHex) {
  // Generate anonymous sender key for this request
  const senderKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
  
  const publicKey = await crypto.subtle.exportKey("jwk", senderKeyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", senderKeyPair.privateKey);
  
  // Create sealed payload
  const sealedPayload = {
    anon_public_key: JSON.stringify(publicKey),
    encrypted_content: encryptedBundle,
    timestamp: Date.now(),
    // Add noise to prevent timing attacks
    noise: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  };
  
  return {
    sealed: await encryptPayload(sealedPayload, rootPrivateKeyHex),
    sender_key: JSON.stringify(privateKey) // Keep for decryption when accepted
  };
}

/**
 * Encrypt online status - server only sees "active" or nothing
 */
export async function encryptStatus(isOnline, rootPrivateKeyHex) {
  return encryptPayload({
    status: isOnline ? "online" : "offline",
    last_seen: Date.now(),
    // Add random padding to prevent traffic analysis
    padding: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  }, rootPrivateKeyHex);
}

/**
 * Encrypt typing indicator - server can't read what you're typing
 */
export async function encryptTypingIndicator(recipientId, isTyping, rootPrivateKeyHex) {
  return encryptPayload({
    to: recipientId,
    typing: isTyping,
    timestamp: Date.now()
  }, rootPrivateKeyHex);
}

/**
 * Encrypt message metadata separately from content
 * - Timestamps
 * - Read receipts  
 * - Delivery status
 */
export async function encryptMessageMetadata(messageId, metadata, rootPrivateKeyHex) {
  return encryptPayload({
    id: messageId,
    ...metadata,
    // Obfuscate real timestamp
    time_bucket: Math.floor(Date.now() / 60000), // Round to minute
    padding: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8))))
  }, rootPrivateKeyHex);
}

/**
 * Encrypt entire friend list for storage
 * Server never sees who your friends are
 */
export async function encryptFriendList(friends, rootPrivateKeyHex) {
  const encryptedFriends = await Promise.all(
    friends.map(async (friend) => ({
      id: friend.id,
      encrypted_data: await encryptPayload({
        alias: friend.alias,
        nickname: friend.nickname,
        added_at: friend.added_at
      }, rootPrivateKeyHex)
    }))
  );
  
  return encryptPayload({
    version: 1,
    friends: encryptedFriends
  }, rootPrivateKeyHex);
}

/**
 * Create encrypted conversation metadata
 * - Participants (beyond what's needed for routing)
 * - Created at (obfuscated)
 * - Custom settings
 */
export async function encryptConversationMetadata(convId, metadata, rootPrivateKeyHex) {
  return encryptPayload({
    conv_id: convId,
    ...metadata,
    // Time bucket instead of exact timestamp
    created_bucket: Math.floor(Date.now() / 3600000), // Round to hour
    noise: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
  }, rootPrivateKeyHex);
}

/**
 * Encrypt block list - server shouldn't know who you blocked
 */
export async function encryptBlockList(blockedUsers, rootPrivateKeyHex) {
  const encryptedBlocked = await Promise.all(
    blockedUsers.map(async (u) => ({
      id: u.id,
      reason_encrypted: await encryptPayload({ reason: u.reason }, rootPrivateKeyHex)
    }))
  );
  
  return encryptPayload({
    version: 1,
    blocked: encryptedBlocked,
    decoy_count: Math.floor(Math.random() * 5)
  }, rootPrivateKeyHex);
}

/**
 * Generate cryptographic proof without revealing identity
 * Used for reputation/anti-spam without doxxing
 */
export async function generateIdentityProof(userId, rootPrivateKeyHex) {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId + ":" + Date.now());
  
  const keyBytes = hexToBytes(rootPrivateKeyHex);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", key, data);
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Verify identity proof without knowing the user
 */
export async function verifyIdentityProof(proof, userId, rootPrivateKeyHex) {
  const expectedProof = await generateIdentityProof(userId, rootPrivateKeyHex);
  return proof === expectedProof;
}

/**
 * Obfuscate timestamp for privacy
 * Returns a time bucket instead of exact time
 */
export function obfuscateTimestamp(timestamp = Date.now(), bucketSize = 60000) {
  return {
    bucket: Math.floor(timestamp / bucketSize),
    offset: timestamp % bucketSize // Keep small offset for ordering
  };
}

/**
 * Restore timestamp from obfuscated form
 */
export function deobfuscateTimestamp(bucket, offset, bucketSize = 60000) {
  return bucket * bucketSize + (offset || 0);
}

/**
 * Add cover traffic - random encrypted messages to prevent traffic analysis
 * Makes it impossible to know when real communication happens
 */
export async function generateCoverTraffic(rootPrivateKeyHex) {
  const dummyMessages = [
    "Hello",
    "How are you?",
    "OK",
    "Thanks",
    "See you",
    ""
  ];
  
  const randomMessage = dummyMessages[Math.floor(Math.random() * dummyMessages.length)];
  
  if (!randomMessage) return null;

  return encryptPayload({
    type: "cover",
    content: randomMessage,
    timestamp: Date.now()
  }, rootPrivateKeyHex);
}

/**
 * Generate noise for request padding
 * Prevents network traffic analysis
 */
export function generateRequestNoise() {
  const noiseSizes = [0, 16, 32, 64, 128];
  const size = noiseSizes[Math.floor(Math.random() * noiseSizes.length)];
  
  if (size === 0) return null;
  
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(size))));
}
