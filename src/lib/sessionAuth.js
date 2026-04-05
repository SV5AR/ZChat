import { setSessionToken, clearSessionToken, getSessionToken, persistSessionTokenToLocal } from "./edgeApi";

const AUTH_FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-signin`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function authHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
}

export async function createSessionToken({
  userId,
  publicKey,
  createAuthChallengeResponse,
  remember = false,
}) {
  if (!userId || !publicKey) {
    throw new Error("Missing session auth inputs");
  }

  if (!createAuthChallengeResponse) {
    throw new Error("Missing challenge-response signer for session auth");
  }

  try {
    const challengeRes = await fetch(`${AUTH_FN_BASE}/challenge`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId }),
    });

    const challengeBody = await challengeRes.json().catch(() => ({}));
    if (!challengeRes.ok || !challengeBody?.challenge) {
      const detail = challengeBody?.detail
        ? `: ${challengeBody.detail}`
        : "";
      throw new Error(
        (challengeBody?.error || "Failed to request auth challenge") + detail,
      );
    }

    const {
      challenge_id: challengeId,
      challenge,
      server_public_key: serverPublicKey,
      server_key_id: serverKeyId,
    } = challengeBody;

    const timestamp = Math.floor(Date.now() / 1000);
    const { challengeResponseHex } = await createAuthChallengeResponse(
      serverPublicKey,
      challenge,
      timestamp,
    );

    const signinRes = await fetch(`${AUTH_FN_BASE}/signin`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        challengeId,
        publicKeyHex: publicKey,
        challenge,
        challengeResponseHex,
        timestamp,
        serverKeyId,
      }),
    });

    const signinBody = await signinRes.json().catch(() => ({}));
    if (!signinRes.ok || !signinBody?.token) {
      const detail = signinBody?.detail ? `: ${signinBody.detail}` : "";
      throw new Error(
        (signinBody?.error || "Failed to create session token") + detail,
      );
    }

    setSessionToken(signinBody.token, signinBody.expires_at || null);
    if (remember) {
      try {
        persistSessionTokenToLocal();
      } catch {
        // ignore persistence failure
      }
    }
    return signinBody;
  } catch (err) {
    throw new Error(err?.message || "Failed to create session token");
  }
}

export async function refreshSessionToken({
  userId,
  publicKey,
  createAuthChallengeResponse,
}) {
  return createSessionToken({ userId, publicKey, createAuthChallengeResponse });
}

export async function revokeSessionToken() {
  const token = getSessionToken();
  if (!token) {
    clearSessionToken();
    return;
  }

  try {
    await fetch(`${AUTH_FN_BASE}/session/revoke`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "x-session-token": token,
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Best-effort revoke
  } finally {
    clearSessionToken();
  }
}

export function dropSessionToken() {
  clearSessionToken();
}
