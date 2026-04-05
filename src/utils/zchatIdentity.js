import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha256";
import { encryptWithKey, deriveAESKeyFromPassword } from "./crypto";

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex input");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function deriveAesKeyFromPrivateKey(privateKeyHex) {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  return await deriveAESKeyFromPassword(
    bytesToHex(privateKeyBytes),
    "username-encryption"
  );
}

export function deriveZchatIdentityFromPhrase(phrase) {
  const normalized = phrase.trim().toLowerCase();
  const phraseBytes = new TextEncoder().encode(normalized);
  const seed32 = new Uint8Array(sha256(phraseBytes)).slice(0, 32);
  const keyPair = nacl.box.keyPair.fromSecretKey(seed32);
  const publicKeyHex = bytesToHex(keyPair.publicKey);
  const privateKeyHex = bytesToHex(seed32);
  const userId = bytesToHex(sha256(keyPair.publicKey));

  return { userId, publicKeyHex, privateKeyHex };
}

export function deriveZchatIdentityFromPrivateKey(privateKeyHex) {
  const secretKey = hexToBytes(privateKeyHex);
  if (secretKey.length !== 32) {
    throw new Error("Invalid private key length");
  }
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
  const publicKeyHex = bytesToHex(keyPair.publicKey);
  const userId = bytesToHex(sha256(keyPair.publicKey));

  return { userId, publicKeyHex, privateKeyHex: bytesToHex(secretKey) };
}

export async function createAuthChallengeResponse(
  privateKeyHex,
  serverPublicKeyHex,
  challenge,
  timestamp,
) {
  const privateKey = hexToBytes(privateKeyHex);
  const serverPublicKey = hexToBytes(serverPublicKeyHex);
  const sharedSecret = nacl.box.before(serverPublicKey, privateKey);

  const key = await window.crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const payload = new TextEncoder().encode(`${challenge}:${timestamp}`);
  const signature = await window.crypto.subtle.sign("HMAC", key, payload);

  return {
    challengeResponseHex: bytesToHex(new Uint8Array(signature)),
  };
}

export async function encryptUsernameForProfile(username, privateKeyHex) {
  const aesKey = await deriveAesKeyFromPrivateKey(privateKeyHex);
  const encryptedUsername = await encryptWithKey(username, aesKey);
  return { encryptedUsername };
}
