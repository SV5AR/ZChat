/**
 * Secure Session Manager
 * Manages Double Ratchet sessions for forward secrecy
 * All session data is encrypted and stored securely
 */

import { secureGetItem, secureSetItem } from "./crypto";
import { DoubleRatchetSession, generateRatchetKeyPair, performRatchetStep, generateMessageId } from "./doubleRatchet";

const SESSION_STORE_KEY = "chatapp_ratchet_sessions";
const SESSION_META_KEY = "chatapp_ratchet_meta";

/**
 * Get all stored sessions
 */
export async function getAllSessions() {
  try {
    const data = await secureGetItem(SESSION_STORE_KEY);
    return data || {};
  } catch {
    return {};
  }
}

/**
 * Get a specific session by conversation ID
 */
export async function getSession(conversationId) {
  const sessions = await getAllSessions();
  const sessionData = sessions[conversationId];
  
  if (!sessionData) return null;
  
  try {
    return DoubleRatchetSession.fromJSON(sessionData);
  } catch (e) {
    console.error("Failed to restore session:", e);
    return null;
  }
}

/**
 * Create or get a session for a conversation
 * If session doesn't exist, initialize with ECDH shared secret
 */
export async function getOrCreateSession(conversationId, ecdhPrivateKey, otherPublicKey, existingSharedSecret = null) {
  // Try to get existing session
  let session = await getSession(conversationId);
  
  if (session) {
    return session;
  }
  
  // Create new session
  if (existingSharedSecret) {
    session = await DoubleRatchetSession.initialize(existingSharedSecret, otherPublicKey);
  } else if (ecdhPrivateKey && otherPublicKey) {
    // Perform ECDH to get shared secret
    const sharedSecret = await performRatchetStep(ecdhPrivateKey, otherPublicKey);
    session = await DoubleRatchetSession.initialize(sharedSecret, otherPublicKey);
  } else {
    // No keys available - can't create session
    console.warn("Cannot create ratchet session without ECDH keys");
    return null;
  }
  
  // Save session
  await saveSession(conversationId, session);
  
  return session;
}

/**
 * Save a session
 */
export async function saveSession(conversationId, session) {
  const sessions = await getAllSessions();
  sessions[conversationId] = session.toJSON();
  await secureSetItem(SESSION_STORE_KEY, sessions);
}

/**
 * Delete a session (when unfriending)
 */
export async function deleteSession(conversationId) {
  const sessions = await getAllSessions();
  delete sessions[conversationId];
  await secureSetItem(SESSION_STORE_KEY, sessions);
}

/**
 * Encrypt message using Double Ratchet (forward secrecy)
 */
export async function sendSecureMessage(conversationId, plaintext, ecdhPrivateKey, otherPublicKey) {
  const session = await getOrCreateSession(conversationId, ecdhPrivateKey, otherPublicKey);
  
  if (!session) {
    throw new Error("Cannot create secure session");
  }
  
  const messageId = generateMessageId();
  const result = await session.encrypt(plaintext);
  
  // Save updated session state
  await saveSession(conversationId, session);
  
  return {
    messageId,
    ciphertext: result.ciphertext,
    counter: result.counter,
    messageKey: result.messageKey // For verification, not sent
  };
}

/**
 * Decrypt message using Double Ratchet
 */
export async function receiveSecureMessage(conversationId, ciphertext, counter, ecdhPrivateKey, otherPublicKey) {
  const session = await getOrCreateSession(conversationId, ecdhPrivateKey, otherPublicKey);
  
  if (!session) {
    throw new Error("Cannot create secure session to decrypt");
  }
  
  const plaintext = await session.decrypt(ciphertext, counter);
  
  // Save updated session state
  await saveSession(conversationId, session);
  
  return plaintext;
}

/**
 * Rotate keys - perform a new ECDH ratchet step
 * Should be done periodically or after N messages
 */
export async function rotateSessionKeys(conversationId, ecdhPrivateKey, otherPublicKey) {
  const session = await getSession(conversationId);
  
  if (!session) {
    console.warn("No session to rotate");
    return;
  }
  
  // Generate new ratchet key pair
  const { publicKey: newRatchetPublicKey } = await generateRatchetKeyPair();
  
  // Perform new ECDH
  const newSharedSecret = await performRatchetStep(ecdhPrivateKey, otherPublicKey);
  
  // Update session with new keys
  // This performs a "DH ratchet" step
  const newRootKey = new Uint8Array(atob(newSharedSecret.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  
  // Re-initialize chains with new shared secret
  session.theirRatchetKey = typeof otherPublicKey === 'string' ? otherPublicKey : JSON.stringify(otherPublicKey);
  session.ourChainKey = newRootKey;
  
  await saveSession(conversationId, session);
  
  return newRatchetPublicKey;
}

/**
 * Get session info for debugging/display
 */
export async function getSessionInfo(conversationId) {
  const session = await getSession(conversationId);
  
  if (!session) {
    return { exists: false };
  }
  
  return {
    exists: true,
    sendCounter: session.sendCounter,
    receiveCounter: session.receiveCounter,
    hasKeys: !!(session.sendingChainKey && session.receivingChainKey)
  };
}

/**
 * Clear all sessions (for logout)
 */
export async function clearAllSessions() {
  await secureSetItem(SESSION_STORE_KEY, {});
}
