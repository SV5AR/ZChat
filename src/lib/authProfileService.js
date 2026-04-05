import {
  deriveZchatIdentityFromPhrase,
  deriveZchatIdentityFromPrivateKey,
  createAuthChallengeResponse,
  encryptUsernameForProfile,
} from "../utils/zchatIdentity";
import { createSessionToken } from "./sessionAuth";
import { edgeGet, edgePost } from "./edgeApi";

function randomUsername() {
  return `user${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizeId(id) {
  return String(id || "").trim().toLowerCase();
}

async function loadProfileById(id) {
  const clean = normalizeId(id);
  if (!clean) return null;
  const body = await edgeGet("/profile", { id: clean });
  return body?.data || null;
}

async function ensureProfile(identity, usernameOverride = null) {
  const existing = await loadProfileById(identity.userId).catch(() => null);
  if (existing) {
    if (
      String(existing.public_key || "").trim().toLowerCase() !==
      String(identity.publicKeyHex || "").trim().toLowerCase()
    ) {
      throw new Error("Identity mismatch for existing account profile");
    }
    return {
      profile: existing,
      username: null,
      created: false,
    };
  }

  const username = String(usernameOverride || randomUsername()).trim();
  const { encryptedUsername } = await encryptUsernameForProfile(
    username,
    identity.privateKeyHex,
  );

  const result = await edgePost("/profile/upsert", {
    id: identity.userId,
    publicKey: identity.publicKeyHex,
    encryptedUsername,
  });

  return {
    profile: result?.data || null,
    username,
    created: true,
  };
}

async function createIdentitySession(identity, remember) {
  return createSessionToken({
    userId: identity.userId,
    publicKey: identity.publicKeyHex,
    createAuthChallengeResponse: (serverPublicKey, challenge, timestamp) =>
      createAuthChallengeResponse(
        identity.privateKeyHex,
        serverPublicKey,
        challenge,
        timestamp,
      ),
    remember,
  });
}

export async function signUpWithPhrase(phrase, remember = false) {
  const identity = deriveZchatIdentityFromPhrase(phrase);
  const check = await loadProfileById(identity.userId).catch(() => null);
  if (check) {
    throw new Error(
      "This phrase is already registered. Please sign in instead.",
    );
  }

  const { username } = await ensureProfile(identity);
  await createIdentitySession(identity, remember);

  return {
    userId: identity.userId,
    privateKey: identity.privateKeyHex,
    publicKey: identity.publicKeyHex,
    username: username || randomUsername(),
  };
}

export async function signInWithPhrase(phrase, remember = false) {
  const identity = deriveZchatIdentityFromPhrase(phrase);
  const profile = await loadProfileById(identity.userId).catch(() => null);
  if (!profile) {
    throw new Error("Phrase not found. Check your words or sign up first.");
  }
  if (
    String(profile.public_key || "").trim().toLowerCase() !==
    String(identity.publicKeyHex || "").trim().toLowerCase()
  ) {
    throw new Error("Identity signature mismatch for this account profile");
  }

  await createIdentitySession(identity, remember);

  return {
    userId: identity.userId,
    privateKey: identity.privateKeyHex,
    publicKey: identity.publicKeyHex,
    encryptedUsername: profile.encrypted_username || null,
  };
}

export async function signInWithPrivateKey(privateKeyHex, remember = false) {
  const identity = deriveZchatIdentityFromPrivateKey(privateKeyHex);
  const profile = await loadProfileById(identity.userId).catch(() => null);
  if (!profile) {
    throw new Error("Account not found for this private key.");
  }
  if (
    String(profile.public_key || "").trim().toLowerCase() !==
    String(identity.publicKeyHex || "").trim().toLowerCase()
  ) {
    throw new Error("Identity signature mismatch for this account profile");
  }

  await createIdentitySession(identity, remember);

  return {
    userId: identity.userId,
    privateKey: identity.privateKeyHex,
    publicKey: identity.publicKeyHex,
    encryptedUsername: profile.encrypted_username || null,
  };
}

export async function getActiveProfile(userId) {
  return loadProfileById(userId);
}
