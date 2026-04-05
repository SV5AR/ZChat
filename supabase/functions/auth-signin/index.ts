import { serve } from "https://deno.land/std@0.201.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import nacl from "https://esm.sh/tweetnacl@1.0.3";

function hexToUint8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(hash));
}

async function hmacSha256Hex(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
}

async function sha256TextHex(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value));
}

function getServerKeyMaterial(serviceRole: string) {
  const keysRaw = Deno.env.get("ZCHAT_AUTH_SERVER_KEYS") || "";
  const activeKeyId = Deno.env.get("ZCHAT_ACTIVE_SERVER_KEY_ID") || "default";

  if (keysRaw) {
    try {
      const parsed = JSON.parse(keysRaw);
      const privateHex = parsed?.[activeKeyId];
      if (typeof privateHex === "string" && /^[0-9a-f]{64}$/i.test(privateHex)) {
        return {
          keyId: activeKeyId,
          privateKey: hexToUint8(privateHex.toLowerCase()),
        };
      }
    } catch {
      // fallback to deterministic legacy key material
    }
  }

  // legacy fallback: deterministic from service role key
  // should be replaced in production by ZCHAT_AUTH_SERVER_KEYS
  return {
    keyId: "legacy-default",
    privateKey: null,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isHex(value: string): boolean {
  return /^[0-9a-f]+$/i.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseRatchetEnvelope(raw: string): { c: string; n: number } | null {
  try {
    const parsed = JSON.parse(raw);
    const c = String(parsed?.c || "").trim();
    const n = Number(parsed?.n);
    if (!c || !Number.isInteger(n) || n < 0) return null;
    return { c, n };
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-session-token",
    },
  });
}

async function resolveSessionUserId(req: Request, supabaseAdmin: ReturnType<typeof createClient>): Promise<string | null> {
  const token = req.headers.get("x-session-token")?.trim() || "";
  if (!token) return null;

  const tokenHash = await sha256TextHex(token);

  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error || !data?.user_id) return null;
  return data.user_id;
}

async function enforceRateLimit(
  supabaseAdmin: ReturnType<typeof createClient>,
  key: string,
  endpoint: string,
  windowSeconds: number,
  maxRequests: number,
  blockSeconds: number,
): Promise<{ ok: boolean; retryAfter?: number; reason?: string }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("auth_rate_limits")
    .select("id, count, blocked_until")
    .eq("key", key)
    .eq("endpoint", endpoint)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, reason: `rate-limit read failed: ${fetchErr.message}` };
  }

  const nowTs = now.getTime();
  if (existing?.blocked_until && new Date(existing.blocked_until).getTime() > nowTs) {
    const retryAfter = Math.ceil((new Date(existing.blocked_until).getTime() - nowTs) / 1000);
    return { ok: false, retryAfter, reason: "blocked" };
  }

  const nextCount = (existing?.count || 0) + 1;
  let blockedUntil: string | null = null;
  if (nextCount > maxRequests) {
    blockedUntil = new Date(nowTs + blockSeconds * 1000).toISOString();
  }

  const payload = {
    key,
    endpoint,
    window_start: windowStart,
    count: nextCount,
    blocked_until: blockedUntil,
    updated_at: now.toISOString(),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from("auth_rate_limits")
    .upsert(payload, { onConflict: "key,endpoint,window_start" });

  if (upsertErr) {
    return { ok: false, reason: `rate-limit write failed: ${upsertErr.message}` };
  }

  if (blockedUntil) {
    return {
      ok: false,
      retryAfter: blockSeconds,
      reason: "too_many_requests",
    };
  }

  return { ok: true };
}

async function consumeActionNonce(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  nonce: string,
  ttlSeconds = 15 * 60,
): Promise<{ ok: boolean; error?: string; code?: number }> {
  const n = String(nonce || "").trim().toLowerCase();
  if (!/^[0-9a-f]{16,128}$/.test(n)) {
    return { ok: false, error: "Invalid nonce format", code: 400 };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const { error } = await supabaseAdmin.from("action_nonces").insert({
    user_id: userId,
    action,
    nonce: n,
    expires_at: expiresAt,
  });

  if (error) {
    const code = String((error as any).code || "");
    if (code === "23505") {
      return { ok: false, error: "Replay detected", code: 409 };
    }
    if (code === "42P01") {
      return { ok: false, error: "action_nonces table missing", code: 500 };
    }
    return { ok: false, error: `Failed nonce validation: ${error.message}`, code: 500 };
  }

  await supabaseAdmin
    .from("action_nonces")
    .delete()
    .lt("expires_at", now.toISOString())
    .then(() => {})
    .catch(() => {});

  return { ok: true };
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isHealth = path === "/health" || path.endsWith("/health");
    const isChallenge = path === "/challenge" || path.endsWith("/challenge");
    const isSignin = path === "/signin" || path === "/" || path.endsWith("/signin");
    const isProfileRead = path === "/profile" || path.endsWith("/profile");
    const isProfileUpsert = path === "/profile/upsert" || path.endsWith("/profile/upsert");
    const isFriendships = path === "/friendships" || path.endsWith("/friendships");
    const isFriendRequest = path === "/friendships/request" || path.endsWith("/friendships/request");
    const isFriendRespond = path === "/friendships/respond" || path.endsWith("/friendships/respond");
    const isFriendRemove = path === "/friendships/remove" || path.endsWith("/friendships/remove");
    const isBlocksRead = path === "/blocks" || path.endsWith("/blocks");
    const isBlockAdd = path === "/blocks/add" || path.endsWith("/blocks/add");
    const isBlockRemove = path === "/blocks/remove" || path.endsWith("/blocks/remove");
    const isMessagesRead = path === "/messages" || path.endsWith("/messages");
    const isMessageSend = path === "/messages/send" || path.endsWith("/messages/send");
    const isMessageEdit = path === "/messages/edit" || path.endsWith("/messages/edit");
    const isMessageDelete = path === "/messages/delete" || path.endsWith("/messages/delete");
    const isMessageHide = path === "/messages/hide" || path.endsWith("/messages/hide");
    const isChatRead = path === "/chat" || path.endsWith("/chat");
    const isChatEnsure = path === "/chat/ensure" || path.endsWith("/chat/ensure");
    const isChatDelete = path === "/chat/delete" || path.endsWith("/chat/delete");
    const isUnreadCounts = path === "/messages/unread-counts" || path.endsWith("/messages/unread-counts");
    const isMarkRead = path === "/messages/mark-read" || path.endsWith("/messages/mark-read");
    const isDeleteAccount = path === "/account/delete" || path.endsWith("/account/delete");
    const isReactionsRead = path === "/reactions" || path.endsWith("/reactions");
    const isReactionUpsert = path === "/reactions/upsert" || path.endsWith("/reactions/upsert");
    const isStatusUpdate = path === "/status/update" || path.endsWith("/status/update");
    const isTyping = path === "/typing" || path.endsWith("/typing");
    const isRatchetState = path === "/ratchet-state" || path.endsWith("/ratchet-state");
    const isUsernameSharesRead = path === "/username-shares" || path.endsWith("/username-shares");
    const isUsernameSharesUpsert = path === "/username-shares/upsert" || path.endsWith("/username-shares/upsert");

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-session-token",
          "access-control-max-age": "86400",
        },
      });
    }

    if (req.method === "GET" && isHealth) return json({ ok: true });

    const supabaseUrl =
      Deno.env.get("ZCHAT_SUPABASE_URL") ||
      Deno.env.get("SUPABASE_URL") ||
      "";
    const serviceRole =
      Deno.env.get("ZCHAT_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      "";
    if (!supabaseUrl || !serviceRole) {
      return json(
        {
          error:
            "Server misconfigured: missing ZCHAT_SUPABASE_URL/ZCHAT_SERVICE_ROLE_KEY (or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)",
        },
        500,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
      },
    });

    const keyMaterial = getServerKeyMaterial(serviceRole);
    let serverPrivate = keyMaterial.privateKey;
    if (!serverPrivate) {
      const serverSeed = await sha256Hex(new TextEncoder().encode(serviceRole));
      serverPrivate = hexToUint8(serverSeed.slice(0, 64));
    }
    const serverPublic = nacl.box.keyPair.fromSecretKey(serverPrivate).publicKey;

    if (req.method === "GET" && isFriendships) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const status = url.searchParams.get("status")?.trim();
      let query = supabaseAdmin.from("friendships").select("*");

      if (status === "pending") {
        query = query.eq("receiver_id", sessionUserId).eq("status", "pending");
      } else if (status === "accepted") {
        query = query.or(`sender_id.eq.${sessionUserId},receiver_id.eq.${sessionUserId}`).eq("status", "accepted");
      } else {
        query = query.or(`sender_id.eq.${sessionUserId},receiver_id.eq.${sessionUserId}`);
      }

      const { data, error } = await query;
      if (error) return json({ error: "Failed to fetch friendships", detail: error.message, code: (error as any).code }, 500);
      return json({ data: data || [] });
    }

    if (req.method === "POST" && isFriendRequest) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as {
        receiverId?: string;
        encryptedKeyBundle?: string;
        requesterUsernameShare?: string;
        nonce?: string;
      } | null;
      const receiverId = body?.receiverId?.trim().toLowerCase();
      const encryptedKeyBundle = body?.encryptedKeyBundle ?? null;
      const requesterUsernameShare = body?.requesterUsernameShare?.trim() || "";
      const nonce = body?.nonce?.trim() || "";
      if (!receiverId) return json({ error: "Missing receiverId" }, 400);
      if (receiverId === sessionUserId) return json({ error: "Cannot add yourself" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "friend_request",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      // Check both directions to avoid duplicate-key errors and provide useful UX messages.
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("friendships")
        .select("id, sender_id, receiver_id, status")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${sessionUserId})`)
        .limit(1)
        .maybeSingle();

      if (existingErr) {
        return json({ error: "Failed to check existing friendship", detail: existingErr.message, code: (existingErr as any).code }, 500);
      }

      if (existing) {
        if (existing.status === "blocked") {
          return json({ error: "Cannot send request while blocked", existing }, 403);
        }

        if (existing.status === "accepted") {
          return json({ error: "Already friends", existing }, 409);
        }

        if (existing.status === "pending") {
          // If current user previously sent it, report pending.
          if (existing.sender_id === sessionUserId) {
            return json({ error: "Friend request already pending", existing }, 409);
          }

          // If inverse pending exists, auto-accept for smoother UX.
          const { data: accepted, error: acceptErr } = await supabaseAdmin
            .from("friendships")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              encrypted_key_bundle: encryptedKeyBundle || existing.encrypted_key_bundle,
              ...(requesterUsernameShare ? { requester_username_share: requesterUsernameShare } : {}),
            })
            .eq("id", existing.id)
            .select("*")
            .single();

          if (acceptErr) {
            return json({ error: "Failed to accept existing pending request", detail: acceptErr.message, code: (acceptErr as any).code }, 500);
          }
          if (requesterUsernameShare) {
            const { data: senderProfile } = await supabaseAdmin
              .from("profiles")
              .select("public_key")
              .eq("id", sessionUserId)
              .maybeSingle();
            if (senderProfile?.public_key) {
              await supabaseAdmin
                .from("username_shares")
                .upsert(
                  {
                    owner_id: sessionUserId,
                    recipient_id: receiverId,
                    owner_public_key: senderProfile.public_key,
                    encrypted_username: requesterUsernameShare,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "owner_id,recipient_id" },
                );
            }
          }

          return json({ data: accepted, auto_accepted: true });
        }

        // rejected or other statuses -> revive as pending by current sender direction
        const senderId = sessionUserId;
        const targetId = receiverId;
        let friendshipId = existing.id;

        if (existing.sender_id !== senderId || existing.receiver_id !== targetId) {
          // Keep pair direction consistent with unique constraint by replacing row.
          const { error: delErr } = await supabaseAdmin.from("friendships").delete().eq("id", existing.id);
          if (delErr) {
            return json({ error: "Failed to reset prior friendship state", detail: delErr.message, code: (delErr as any).code }, 500);
          }
          friendshipId = null as unknown as string;
        }

        if (friendshipId) {
          const { data: updated, error: updErr } = await supabaseAdmin
            .from("friendships")
            .update({
              status: "pending",
              updated_at: new Date().toISOString(),
              encrypted_key_bundle: encryptedKeyBundle,
              ...(requesterUsernameShare ? { requester_username_share: requesterUsernameShare } : {}),
            })
            .eq("id", friendshipId)
            .select("*")
            .single();

          if (updErr) return json({ error: "Failed to refresh friend request", detail: updErr.message, code: (updErr as any).code }, 500);
          return json({ data: updated, revived: true });
        }
      }

      const { data, error } = await supabaseAdmin
        .from("friendships")
        .insert({
          sender_id: sessionUserId,
          receiver_id: receiverId,
          status: "pending",
          encrypted_key_bundle: encryptedKeyBundle,
          requester_username_share: requesterUsernameShare || null,
        })
        .select("*")
        .single();

      if (error) return json({ error: "Failed to send friend request", detail: error.message, code: (error as any).code }, 500);
      return json({ data });
    }

    if (req.method === "POST" && isFriendRespond) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as {
        friendshipId?: string;
        accept?: boolean;
        encryptedKeyBundle?: string;
        accepterUsernameShare?: string;
        nonce?: string;
      } | null;
      const friendshipId = body?.friendshipId;
      const nonce = body?.nonce?.trim() || "";
      if (!friendshipId) return json({ error: "Missing friendshipId" }, 400);
      if (typeof body?.accept !== "boolean") return json({ error: "Missing or invalid accept flag" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "friend_respond",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const accept = body.accept;

      const { data: current, error: currentErr } = await supabaseAdmin
        .from("friendships")
        .select("id, sender_id, receiver_id, status, requester_username_share")
        .eq("id", friendshipId)
        .maybeSingle();

      if (currentErr) return json({ error: "Failed to fetch friendship", detail: currentErr.message, code: (currentErr as any).code }, 500);
      if (!current) return json({ error: "Friend request not found" }, 404);
      if (current.receiver_id !== sessionUserId) return json({ error: "Forbidden" }, 403);
      if (current.status !== "pending") {
        return json({
          error: `Cannot respond to request in '${current.status}' state`,
          data: current,
          previous_status: current.status,
          new_status: current.status,
        }, 409);
      }

      const updatePayload: Record<string, unknown> = {
        status: accept ? "accepted" : "rejected",
        updated_at: new Date().toISOString(),
      };
      if (accept) {
        updatePayload.accepted_at = new Date().toISOString();
      } else {
        updatePayload.accepted_at = null;
      }
      if (body?.encryptedKeyBundle) {
        updatePayload.encrypted_key_bundle = body.encryptedKeyBundle;
      }

      const { data, error } = await supabaseAdmin
        .from("friendships")
        .update(updatePayload)
        .eq("id", friendshipId)
        .eq("receiver_id", sessionUserId)
        .select("*")
        .single();

      if (error) return json({ error: "Failed to respond to request", detail: error.message, code: (error as any).code }, 500);

      if (accept && data?.sender_id && data?.receiver_id) {
        try {
          const requesterId = String(data.sender_id);
          const accepterId = String(data.receiver_id);
          const accepterUsernameShare = body?.accepterUsernameShare?.trim() || "";

          const { data: requesterProfile } = await supabaseAdmin
            .from("profiles")
            .select("public_key, encrypted_username")
            .eq("id", requesterId)
            .maybeSingle();
          const { data: accepterProfile } = await supabaseAdmin
            .from("profiles")
            .select("public_key, encrypted_username")
            .eq("id", accepterId)
            .maybeSingle();

          const requesterStoredShare = String(current.requester_username_share || "").trim();
          const encryptedForAccepter = requesterStoredShare || requesterProfile?.encrypted_username;
          if (requesterProfile?.public_key && encryptedForAccepter) {
            await supabaseAdmin
              .from("username_shares")
              .upsert(
                {
                  owner_id: requesterId,
                  recipient_id: accepterId,
                  owner_public_key: requesterProfile.public_key,
                  encrypted_username: encryptedForAccepter,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "owner_id,recipient_id" },
              );
          }

          if (accepterProfile?.public_key && accepterProfile?.encrypted_username) {
            const encryptedForRequester = accepterUsernameShare || accepterProfile.encrypted_username;
            await supabaseAdmin
              .from("username_shares")
              .upsert(
                {
                  owner_id: accepterId,
                  recipient_id: requesterId,
                  owner_public_key: accepterProfile.public_key,
                  encrypted_username: encryptedForRequester,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "owner_id,recipient_id" },
              );
          }
        } catch (shareErr) {
          console.warn("username share seed on accept failed:", shareErr);
        }
      }

      return json({
        data,
        previous_status: current.status,
        new_status: data?.status || current.status,
      });
    }

    if (req.method === "POST" && isFriendRemove) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { friendshipId?: string; nonce?: string } | null;
      const friendshipId = body?.friendshipId;
      const nonce = body?.nonce?.trim() || "";
      if (!friendshipId) return json({ error: "Missing friendshipId" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "friend_remove",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const { data: f, error: fetchErr } = await supabaseAdmin
        .from("friendships")
        .select("id, sender_id, receiver_id")
        .eq("id", friendshipId)
        .single();

      if (fetchErr) return json({ error: "Failed to fetch friendship", detail: fetchErr.message, code: (fetchErr as any).code }, 500);
      if (f.sender_id !== sessionUserId && f.receiver_id !== sessionUserId) return json({ error: "Forbidden" }, 403);

      const a = String(f.sender_id);
      const b = String(f.receiver_id);

      const { data: msgIds } = await supabaseAdmin
        .from("messages")
        .select("id")
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);

      const ids = (msgIds || []).map((m: any) => m.id).filter(Boolean);
      if (ids.length) {
        await supabaseAdmin.from("reactions").delete().in("message_id", ids);
        await supabaseAdmin.from("messages_hidden").delete().in("message_id", ids);
      }
      await supabaseAdmin
        .from("messages")
        .delete()
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
      await supabaseAdmin
        .from("ratchet_states")
        .delete()
        .or(`and(user_id.eq.${a},conversation_key.eq.${a}:${b}),and(user_id.eq.${a},conversation_key.eq.${b}:${a}),and(user_id.eq.${b},conversation_key.eq.${a}:${b}),and(user_id.eq.${b},conversation_key.eq.${b}:${a})`);
      await supabaseAdmin
        .from("username_shares")
        .delete()
        .or(`and(owner_id.eq.${a},recipient_id.eq.${b}),and(owner_id.eq.${b},recipient_id.eq.${a})`);
      await supabaseAdmin
        .from("chat_rows")
        .delete()
        .or(`and(user_a.eq.${a},user_b.eq.${b}),and(user_a.eq.${b},user_b.eq.${a})`);

      const { error } = await supabaseAdmin.from("friendships").delete().eq("id", friendshipId);
      if (error) return json({ error: "Failed to remove friend", detail: error.message, code: (error as any).code }, 500);
      return json({ success: true });
    }

    if (req.method === "GET" && isBlocksRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const { data, error } = await supabaseAdmin
        .from("friendships")
        .select("id, receiver_id, created_at, updated_at")
        .eq("sender_id", sessionUserId)
        .eq("status", "blocked")
        .order("updated_at", { ascending: false });

      if (error) {
        return json({ error: "Failed to load blocked users", detail: error.message, code: (error as any).code }, 500);
      }

      const rows = (data || []).map((row) => ({
        id: row.id,
        blocker_id: sessionUserId,
        blocked_id: row.receiver_id,
        created_at: row.updated_at || row.created_at,
      }));
      return json({ data: rows });
    }

    if (req.method === "POST" && isBlockAdd) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { blockedId?: string; nonce?: string } | null;
      const blockedId = body?.blockedId?.trim().toLowerCase();
      const nonce = body?.nonce?.trim() || "";
      if (!blockedId) return json({ error: "Missing blockedId" }, 400);
      if (blockedId === sessionUserId) return json({ error: "Cannot block yourself" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "block_add",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("friendships")
        .select("id, sender_id, receiver_id, status")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${blockedId}),and(sender_id.eq.${blockedId},receiver_id.eq.${sessionUserId})`)
        .limit(1)
        .maybeSingle();

      if (existingErr) {
        return json({ error: "Failed to check current relationship", detail: existingErr.message, code: (existingErr as any).code }, 500);
      }

      const now = new Date().toISOString();

      if (existing) {
        if (existing.sender_id === sessionUserId && existing.receiver_id === blockedId) {
          const { data: updated, error: updErr } = await supabaseAdmin
            .from("friendships")
            .update({
              status: "blocked",
              accepted_at: null,
              encrypted_key_bundle: null,
              updated_at: now,
            })
            .eq("id", existing.id)
            .select("id, sender_id, receiver_id, status, updated_at")
            .single();
          if (updErr) {
            return json({ error: "Failed to block user", detail: updErr.message, code: (updErr as any).code }, 500);
          }
          const a = sessionUserId;
          const b = blockedId;
          const { data: msgIds } = await supabaseAdmin
            .from("messages")
            .select("id")
            .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
          const ids = (msgIds || []).map((m: any) => m.id).filter(Boolean);
          if (ids.length) {
            await supabaseAdmin.from("reactions").delete().in("message_id", ids);
            await supabaseAdmin.from("messages_hidden").delete().in("message_id", ids);
          }
          await supabaseAdmin
            .from("messages")
            .delete()
            .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
          await supabaseAdmin
            .from("ratchet_states")
            .delete()
            .or(`and(user_id.eq.${a},conversation_key.eq.${a}:${b}),and(user_id.eq.${a},conversation_key.eq.${b}:${a}),and(user_id.eq.${b},conversation_key.eq.${a}:${b}),and(user_id.eq.${b},conversation_key.eq.${b}:${a})`);
          await supabaseAdmin
            .from("username_shares")
            .delete()
            .or(`and(owner_id.eq.${a},recipient_id.eq.${b}),and(owner_id.eq.${b},recipient_id.eq.${a})`);
          await supabaseAdmin
            .from("chat_rows")
            .delete()
            .or(`and(user_a.eq.${a},user_b.eq.${b}),and(user_a.eq.${b},user_b.eq.${a})`);

          return json({ data: updated });
        }

        const { error: delErr } = await supabaseAdmin.from("friendships").delete().eq("id", existing.id);
        if (delErr) {
          return json({ error: "Failed to replace inverse relationship", detail: delErr.message, code: (delErr as any).code }, 500);
        }
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("friendships")
        .insert({
          sender_id: sessionUserId,
          receiver_id: blockedId,
          status: "blocked",
          encrypted_key_bundle: null,
          accepted_at: null,
          updated_at: now,
        })
        .select("id, sender_id, receiver_id, status, updated_at")
        .single();

      if (insErr) {
        return json({ error: "Failed to block user", detail: insErr.message, code: (insErr as any).code }, 500);
      }

      const a = sessionUserId;
      const b = blockedId;
      const { data: msgIds } = await supabaseAdmin
        .from("messages")
        .select("id")
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
      const ids = (msgIds || []).map((m: any) => m.id).filter(Boolean);
      if (ids.length) {
        await supabaseAdmin.from("reactions").delete().in("message_id", ids);
        await supabaseAdmin.from("messages_hidden").delete().in("message_id", ids);
      }
      await supabaseAdmin
        .from("messages")
        .delete()
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
      await supabaseAdmin
        .from("ratchet_states")
        .delete()
        .or(`and(user_id.eq.${a},conversation_key.eq.${a}:${b}),and(user_id.eq.${a},conversation_key.eq.${b}:${a}),and(user_id.eq.${b},conversation_key.eq.${a}:${b}),and(user_id.eq.${b},conversation_key.eq.${b}:${a})`);
      await supabaseAdmin
        .from("username_shares")
        .delete()
        .or(`and(owner_id.eq.${a},recipient_id.eq.${b}),and(owner_id.eq.${b},recipient_id.eq.${a})`);
      await supabaseAdmin
        .from("chat_rows")
        .delete()
        .or(`and(user_a.eq.${a},user_b.eq.${b}),and(user_a.eq.${b},user_b.eq.${a})`);

      return json({ data: inserted });
    }

    if (req.method === "POST" && isBlockRemove) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { blockedId?: string; nonce?: string } | null;
      const blockedId = body?.blockedId?.trim().toLowerCase();
      const nonce = body?.nonce?.trim() || "";
      if (!blockedId) return json({ error: "Missing blockedId" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "block_remove",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const { error } = await supabaseAdmin
        .from("friendships")
        .delete()
        .eq("sender_id", sessionUserId)
        .eq("receiver_id", blockedId)
        .eq("status", "blocked");

      if (error) {
        return json({ error: "Failed to unblock user", detail: error.message, code: (error as any).code }, 500);
      }

      return json({ success: true });
    }

    if (req.method === "GET" && isMessagesRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const friendId = url.searchParams.get("friendId")?.trim().toLowerCase();
      const since = url.searchParams.get("since")?.trim();
      const before = url.searchParams.get("before")?.trim();
      const limitRaw = Number(url.searchParams.get("limit") || "50");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;
      if (!friendId) return json({ error: "Missing friendId" }, 400);

      const { data: friendship, error: friendshipErr } = await supabaseAdmin
        .from("friendships")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();

      if (friendshipErr) return json({ error: "Failed to validate friendship", detail: friendshipErr.message, code: (friendshipErr as any).code }, 500);
      if (!friendship) return json({ error: "Friendship required" }, 403);

      let query = supabaseAdmin
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (since) query = query.gt("created_at", since);
      if (before) query = query.lt("created_at", before);

      const { data, error } = await query;
      if (error) return json({ error: "Failed to fetch messages", detail: error.message, code: (error as any).code }, 500);
      let rows = data || [];
      const ids = rows.map((r: any) => r.id).filter(Boolean);
      if (ids.length) {
        const { data: hiddenRows } = await supabaseAdmin
          .from("messages_hidden")
          .select("message_id")
          .eq("user_id", sessionUserId)
          .in("message_id", ids);
        const hiddenSet = new Set((hiddenRows || []).map((r: any) => r.message_id));
        rows = rows.filter((r: any) => !hiddenSet.has(r.id));
      }
      return json({ data: rows.slice().reverse() });
    }

    if (req.method === "POST" && isMessageSend) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { receiverId?: string; encryptedContent?: string; nonce?: string; replyToMessageId?: string } | null;
      const receiverId = body?.receiverId?.trim().toLowerCase();
      const encryptedContent = body?.encryptedContent;
      const nonce = body?.nonce;
      const replyToMessageId = body?.replyToMessageId?.trim() || null;
      if (!receiverId || !encryptedContent || !nonce) return json({ error: "Missing message fields" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "message_send",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }
      if (!parseRatchetEnvelope(encryptedContent)) {
        return json({ error: "Invalid ratchet encrypted content" }, 400);
      }
      if (replyToMessageId && !isUuid(replyToMessageId)) {
        return json({ error: "Invalid replyToMessageId" }, 400);
      }

      const { data: friendship, error: friendshipErr } = await supabaseAdmin
        .from("friendships")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${sessionUserId})`)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();

      if (friendshipErr) return json({ error: "Failed to validate friendship", detail: friendshipErr.message, code: (friendshipErr as any).code }, 500);
      if (!friendship) return json({ error: "Friendship required" }, 403);

      if (replyToMessageId) {
        const { data: parent, error: parentErr } = await supabaseAdmin
          .from("messages")
          .select("id, sender_id, receiver_id")
          .eq("id", replyToMessageId)
          .maybeSingle();
        if (parentErr) {
          return json({ error: "Failed to validate reply target", detail: parentErr.message, code: (parentErr as any).code }, 500);
        }
        if (!parent) return json({ error: "Reply target not found" }, 404);
        const isSameConversation =
          (parent.sender_id === sessionUserId && parent.receiver_id === receiverId) ||
          (parent.sender_id === receiverId && parent.receiver_id === sessionUserId);
        if (!isSameConversation) return json({ error: "Reply target does not belong to this conversation" }, 403);
      }

      let insertResult = await supabaseAdmin
        .from("messages")
        .insert({
          sender_id: sessionUserId,
          receiver_id: receiverId,
          encrypted_content: encryptedContent,
          nonce,
          reply_to_message_id: replyToMessageId,
        })
        .select("*")
        .single();

      if (insertResult.error && String((insertResult.error as any).code || "") === "42703") {
        insertResult = await supabaseAdmin
          .from("messages")
          .insert({
            sender_id: sessionUserId,
            receiver_id: receiverId,
            encrypted_content: encryptedContent,
            nonce,
          })
          .select("*")
          .single();
      }

      if (insertResult.error) return json({ error: "Failed to send message", detail: insertResult.error.message, code: (insertResult.error as any).code }, 500);
      return json({ data: insertResult.data });
    }

    if (req.method === "POST" && isMessageEdit) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { messageId?: string; encryptedContent?: string; nonce?: string } | null;
      const messageId = body?.messageId?.trim();
      const encryptedContent = body?.encryptedContent;
      const nonce = body?.nonce;
      if (!messageId || !encryptedContent || !nonce) return json({ error: "Missing message edit fields" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "message_edit",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }
      if (!isUuid(messageId)) return json({ error: "Invalid messageId" }, 400);
      if (!parseRatchetEnvelope(encryptedContent)) {
        return json({ error: "Invalid ratchet encrypted content" }, 400);
      }

      const primaryUpdate = {
        encrypted_content: encryptedContent,
        nonce,
        updated_at: new Date().toISOString(),
        is_edited: true,
      } as Record<string, unknown>;

      let result = await supabaseAdmin
        .from("messages")
        .update(primaryUpdate)
        .eq("id", messageId)
        .eq("sender_id", sessionUserId)
        .select("*")
        .single();

      if (result.error && String((result.error as any).code || "") === "42703") {
        // Backward-compat fallback for deployments without is_edited/updated_at columns.
        result = await supabaseAdmin
          .from("messages")
          .update({ encrypted_content: encryptedContent, nonce })
          .eq("id", messageId)
          .eq("sender_id", sessionUserId)
          .select("*")
          .single();
      }

      if (result.error) return json({ error: "Failed to edit message", detail: result.error.message, code: (result.error as any).code }, 500);
      return json({ data: result.data });
    }

    if (req.method === "POST" && isMessageDelete) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { messageId?: string; nonce?: string } | null;
      const messageId = body?.messageId?.trim();
      const nonce = body?.nonce?.trim() || "";
      if (!messageId) return json({ error: "Missing messageId" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "message_delete",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }
      if (!isUuid(messageId)) return json({ error: "Invalid messageId" }, 400);

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("messages")
        .select("id, sender_id, receiver_id")
        .eq("id", messageId)
        .maybeSingle();

      if (existingErr) return json({ error: "Failed to fetch message", detail: existingErr.message, code: (existingErr as any).code }, 500);
      if (!existing) return json({ error: "Message not found" }, 404);
      if (existing.sender_id !== sessionUserId && existing.receiver_id !== sessionUserId) {
        return json({ error: "Not authorized to delete this message" }, 403);
      }

      const { error } = await supabaseAdmin
        .from("messages")
        .delete()
        .eq("id", messageId);

      if (error) return json({ error: "Failed to delete message", detail: error.message, code: (error as any).code }, 500);
      return json({ success: true, messageId });
    }

    if (req.method === "POST" && isMessageHide) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { messageId?: string; friendId?: string; nonce?: string } | null;
      const messageId = body?.messageId?.trim() || "";
      const friendId = body?.friendId?.trim().toLowerCase() || "";
      const nonce = body?.nonce?.trim() || "";

      if (!messageId && !friendId) {
        return json({ error: "Missing messageId or friendId" }, 400);
      }
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "message_hide",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      if (messageId) {
        if (!isUuid(messageId)) return json({ error: "Invalid messageId" }, 400);
        const { data: msg } = await supabaseAdmin
          .from("messages")
          .select("id, sender_id, receiver_id")
          .eq("id", messageId)
          .maybeSingle();
        if (!msg) return json({ error: "Message not found" }, 404);
        if (msg.sender_id !== sessionUserId && msg.receiver_id !== sessionUserId) {
          return json({ error: "Forbidden" }, 403);
        }
        await supabaseAdmin
          .from("messages_hidden")
          .upsert(
            {
              message_id: messageId,
              user_id: sessionUserId,
              hidden_at: new Date().toISOString(),
            },
            { onConflict: "message_id,user_id" },
          );
        return json({ success: true, messageId });
      }

      const { data: rows } = await supabaseAdmin
        .from("messages")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .limit(5000);
      const ids = (rows || []).map((r: any) => r.id).filter(Boolean);
      if (ids.length === 0) return json({ success: true, hidden: 0 });

      const payload = ids.map((id: string) => ({
        message_id: id,
        user_id: sessionUserId,
        hidden_at: new Date().toISOString(),
      }));

      const { error: hideErr } = await supabaseAdmin
        .from("messages_hidden")
        .upsert(payload, { onConflict: "message_id,user_id" });
      if (hideErr) return json({ error: "Failed to hide conversation", detail: hideErr.message, code: (hideErr as any).code }, 500);
      return json({ success: true, hidden: ids.length });
    }

    if (req.method === "GET" && isChatRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const { data, error } = await supabaseAdmin
        .from("chat_rows")
        .select("id,user_a,user_b,created_by,created_at,updated_at")
        .or(`user_a.eq.${sessionUserId},user_b.eq.${sessionUserId}`)
        .order("updated_at", { ascending: false });

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01") return json({ data: [] });
        return json({ error: "Failed to load chat rows", detail: error.message, code: (error as any).code }, 500);
      }
      return json({ data: data || [] });
    }

    if (req.method === "POST" && isChatEnsure) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);
      const body = await req.json().catch(() => null) as { friendId?: string; nonce?: string } | null;
      const friendId = body?.friendId?.trim().toLowerCase();
      const nonce = body?.nonce?.trim() || "";
      if (!friendId) return json({ error: "Missing friendId" }, 400);
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "chat_ensure",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const { data: friendship, error: friendshipErr } = await supabaseAdmin
        .from("friendships")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();
      if (friendshipErr) return json({ error: "Failed to validate friendship", detail: friendshipErr.message, code: (friendshipErr as any).code }, 500);
      if (!friendship) return json({ error: "Friendship required" }, 403);

      const a = sessionUserId < friendId ? sessionUserId : friendId;
      const b = sessionUserId < friendId ? friendId : sessionUserId;
      const { data, error } = await supabaseAdmin
        .from("chat_rows")
        .upsert(
          {
            user_a: a,
            user_b: b,
            created_by: sessionUserId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_a,user_b" },
        )
        .select("id,user_a,user_b,created_by,created_at,updated_at")
        .single();

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01") return json({ error: "chat_rows table missing" }, 500);
        return json({ error: "Failed to ensure chat row", detail: error.message, code: (error as any).code }, 500);
      }
      return json({ data });
    }

    if (req.method === "POST" && isChatDelete) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);
      const body = await req.json().catch(() => null) as { friendId?: string } | null;
      const friendId = body?.friendId?.trim().toLowerCase();
      if (!friendId) return json({ error: "Missing friendId" }, 400);

      const { data: friendship, error: friendshipErr } = await supabaseAdmin
        .from("friendships")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();
      if (friendshipErr) return json({ error: "Failed to validate friendship", detail: friendshipErr.message, code: (friendshipErr as any).code }, 500);
      if (!friendship) return json({ error: "Friendship required" }, 403);

      const a = sessionUserId;
      const b = friendId;
      const { data: msgIds } = await supabaseAdmin
        .from("messages")
        .select("id")
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
      const ids = (msgIds || []).map((m: any) => m.id).filter(Boolean);
      if (ids.length) {
        await supabaseAdmin.from("reactions").delete().in("message_id", ids);
      }
      await supabaseAdmin
        .from("messages")
        .delete()
        .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`);
      if (ids.length) {
        await supabaseAdmin
          .from("messages_hidden")
          .delete()
          .in("message_id", ids);
      }
      await supabaseAdmin
        .from("ratchet_states")
        .delete()
        .or(`and(user_id.eq.${a},conversation_key.eq.${a}:${b}),and(user_id.eq.${a},conversation_key.eq.${b}:${a}),and(user_id.eq.${b},conversation_key.eq.${a}:${b}),and(user_id.eq.${b},conversation_key.eq.${b}:${a})`);

      await supabaseAdmin
        .from("chat_rows")
        .delete()
        .or(`and(user_a.eq.${a},user_b.eq.${b}),and(user_a.eq.${b},user_b.eq.${a})`);

      return json({ success: true });
    }

    if (req.method === "GET" && isUnreadCounts) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const { data, error } = await supabaseAdmin
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", sessionUserId)
        .is("read_at", null);

      if (error) return json({ error: "Failed to fetch unread counts", detail: error.message, code: (error as any).code }, 500);

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
      }
      return json({ data: Object.entries(counts).map(([friend_id, unread_count]) => ({ friend_id, unread_count })) });
    }

    if (req.method === "POST" && isMarkRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { friendId?: string } | null;
      const friendId = body?.friendId?.trim().toLowerCase();
      if (!friendId) return json({ error: "Missing friendId" }, 400);

      const { error } = await supabaseAdmin
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("receiver_id", sessionUserId)
        .eq("sender_id", friendId)
        .is("read_at", null);

      if (error) return json({ error: "Failed to mark messages read", detail: error.message, code: (error as any).code }, 500);
      return json({ success: true });
    }

    if (req.method === "GET" && isReactionsRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const messageId = url.searchParams.get("messageId")?.trim();
      if (!messageId) return json({ error: "Missing messageId" }, 400);
      if (!isUuid(messageId)) return json({ error: "Invalid messageId" }, 400);

      const { data, error } = await supabaseAdmin
        .from("reactions")
        .select("*")
        .eq("message_id", messageId);

      if (error) return json({ error: "Failed to fetch reactions", detail: error.message, code: (error as any).code }, 500);
      return json({ data: data || [] });
    }

    if (req.method === "POST" && isReactionUpsert) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { messageId?: string; encryptedEmoji?: string; nonce?: string } | null;
      const messageId = body?.messageId;
      const encryptedEmoji = body?.encryptedEmoji;
      const nonce = body?.nonce;
      if (!messageId || encryptedEmoji === undefined || encryptedEmoji === null || !nonce) {
        return json({ error: "Missing reaction fields" }, 400);
      }
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "reaction_upsert",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }
      if (!isUuid(messageId)) return json({ error: "Invalid messageId" }, 400);

      const { data: msg, error: msgErr } = await supabaseAdmin
        .from("messages")
        .select("id, sender_id, receiver_id")
        .eq("id", messageId)
        .maybeSingle();
      if (msgErr) {
        return json({ error: "Failed to validate message", detail: msgErr.message, code: (msgErr as any).code }, 500);
      }
      if (!msg) return json({ error: "Message not found" }, 404);
      if (msg.sender_id !== sessionUserId && msg.receiver_id !== sessionUserId) {
        return json({ error: "Forbidden" }, 403);
      }

      const reactionId = String((body as any)?.reactionId || "").trim();

      if (String(encryptedEmoji).trim() === "") {
        if (reactionId) {
          const { error } = await supabaseAdmin
            .from("reactions")
            .delete()
            .eq("id", reactionId)
            .eq("user_id", sessionUserId);
          if (error) return json({ error: "Failed to clear reaction", detail: error.message, code: (error as any).code }, 500);
          return json({ success: true, cleared: true });
        }
        const { error } = await supabaseAdmin
          .from("reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", sessionUserId);
        if (error) return json({ error: "Failed to clear reaction", detail: error.message, code: (error as any).code }, 500);
        return json({ success: true, cleared: true });
      }

      const { data: insertedReaction, error } = await supabaseAdmin
        .from("reactions")
        .insert({
          message_id: messageId,
          user_id: sessionUserId,
          encrypted_emoji: encryptedEmoji,
          nonce,
        })
        .select("*")
        .single();

      if (error) return json({ error: "Failed to add reaction", detail: error.message, code: (error as any).code }, 500);
      return json({ success: true, data: insertedReaction });
    }

    if (req.method === "POST" && isDeleteAccount) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { nonce?: string } | null;
      const nonce = body?.nonce?.trim() || "";
      if (!nonce) return json({ error: "Missing nonce" }, 400);
      {
        const gate = await consumeActionNonce(
          supabaseAdmin,
          sessionUserId,
          "account_delete",
          nonce,
        );
        if (!gate.ok) return json({ error: gate.error || "Invalid nonce" }, gate.code || 400);
      }

      const { error: msgErr } = await supabaseAdmin.from("messages").delete().or(`sender_id.eq.${sessionUserId},receiver_id.eq.${sessionUserId}`);
      if (msgErr) return json({ error: "Failed to delete messages", detail: msgErr.message, code: (msgErr as any).code }, 500);

      await supabaseAdmin.from("messages_hidden").delete().eq("user_id", sessionUserId);
      await supabaseAdmin.from("reactions").delete().eq("user_id", sessionUserId);
      await supabaseAdmin.from("ratchet_states").delete().eq("user_id", sessionUserId);
      await supabaseAdmin.from("username_shares").delete().or(`owner_id.eq.${sessionUserId},recipient_id.eq.${sessionUserId}`);
      await supabaseAdmin.from("chat_rows").delete().or(`user_a.eq.${sessionUserId},user_b.eq.${sessionUserId}`);

      const { error: friendErr } = await supabaseAdmin.from("friendships").delete().or(`sender_id.eq.${sessionUserId},receiver_id.eq.${sessionUserId}`);
      if (friendErr) return json({ error: "Failed to delete friendships", detail: friendErr.message, code: (friendErr as any).code }, 500);

      const { error: profileErr } = await supabaseAdmin.from("profiles").delete().eq("id", sessionUserId);
      if (profileErr) return json({ error: "Failed to delete profile", detail: profileErr.message, code: (profileErr as any).code }, 500);

      await supabaseAdmin.from("sessions").delete().eq("user_id", sessionUserId);
      await supabaseAdmin.from("auth_rate_limits").delete().ilike("key", `${sessionUserId}:%`);
      await supabaseAdmin.from("action_nonces").delete().eq("user_id", sessionUserId);
      return json({ success: true });
    }

    // Status update - for encrypted online/offline status
    if (req.method === "POST" && isStatusUpdate) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { encrypted?: string; noise?: string } | null;
      const { encrypted, noise } = body || {};

      // Store encrypted status - server never sees plaintext
      // For now, we acknowledge receipt. Status could be stored in a separate table if needed.
      // The encryption provides metadata privacy - server only sees encrypted blob.
      return json({ success: true, received: true });
    }

    // Typing indicator - for encrypted typing status
    if (req.method === "POST" && isTyping) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as { encrypted?: string; noise?: string } | null;
      const { encrypted, noise } = body || {};

      // Store encrypted typing indicator - server never sees plaintext
      // The encryption provides metadata privacy - server only sees encrypted blob.
      return json({ success: true, received: true });
    }

    // Ratchet state storage - encrypted client state for forward secrecy
    if (req.method === "GET" && isRatchetState) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const { data, error } = await supabaseAdmin
        .from("ratchet_states")
        .select("conversation_key, encrypted_state, updated_at")
        .eq("user_id", sessionUserId)
        .order("updated_at", { ascending: false });

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01" || error.message?.toLowerCase().includes("ratchet_states")) {
          return json({ data: [] });
        }
        return json({ error: "Failed to load ratchet states", detail: error.message, code: (error as any).code }, 500);
      }
      return json({ data: data || [] });
    }

    if (req.method === "POST" && isRatchetState) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as {
        conversation_key?: string;
        encrypted_state?: string;
      } | null;

      const conversationKey = body?.conversation_key?.trim();
      const encryptedState = body?.encrypted_state?.trim();

      if (!conversationKey || !encryptedState) {
        return json({ error: "Missing conversation_key or encrypted_state" }, 400);
      }

      const { data, error } = await supabaseAdmin
        .from("ratchet_states")
        .upsert(
          {
            user_id: sessionUserId,
            conversation_key: conversationKey,
            encrypted_state: encryptedState,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,conversation_key" },
        )
        .select("conversation_key, encrypted_state, updated_at")
        .single();

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01" || error.message?.toLowerCase().includes("ratchet_states")) {
          return json({ data: null, skipped: true });
        }
        return json({ error: "Failed to save ratchet state", detail: error.message, code: (error as any).code }, 500);
      }

      return json({ data });
    }

    if (req.method === "GET" && isProfileRead) {
      const id = url.searchParams.get("id")?.trim().toLowerCase();
      if (!id) return json({ error: "Missing id" }, 400);

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, public_key, encrypted_username, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();

      if (error) return json({ error: "Failed to fetch profile", detail: error.message, code: (error as any).code }, 500);
      return json({ data: data || null });
    }

    if (req.method === "GET" && isUsernameSharesRead) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const { data, error } = await supabaseAdmin
        .from("username_shares")
        .select("id, owner_id, recipient_id, owner_public_key, encrypted_username, updated_at")
        .eq("recipient_id", sessionUserId)
        .order("updated_at", { ascending: false });

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01") return json({ data: [] });
        return json({ error: "Failed to load username shares", detail: error.message, code: (error as any).code }, 500);
      }
      return json({ data: data || [] });
    }

    if (req.method === "POST" && isUsernameSharesUpsert) {
      const sessionUserId = await resolveSessionUserId(req, supabaseAdmin);
      if (!sessionUserId) return json({ error: "Unauthorized session" }, 401);

      const body = await req.json().catch(() => null) as {
        friendId?: string;
        encryptedUsername?: string;
      } | null;
      const friendId = body?.friendId?.trim().toLowerCase();
      const encryptedUsername = body?.encryptedUsername?.trim();
      if (!friendId || !encryptedUsername) {
        return json({ error: "Missing friendId/encryptedUsername" }, 400);
      }

      const { data: friendship, error: friendshipErr } = await supabaseAdmin
        .from("friendships")
        .select("id")
        .or(`and(sender_id.eq.${sessionUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${sessionUserId})`)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();
      if (friendshipErr) {
        return json({ error: "Failed to validate friendship", detail: friendshipErr.message, code: (friendshipErr as any).code }, 500);
      }
      if (!friendship) return json({ error: "Friendship required" }, 403);

      const { data: ownerProfile, error: ownerErr } = await supabaseAdmin
        .from("profiles")
        .select("public_key")
        .eq("id", sessionUserId)
        .maybeSingle();
      if (ownerErr || !ownerProfile?.public_key) {
        return json({ error: "Failed to load owner profile key", detail: ownerErr?.message || "Missing public key" }, 500);
      }

      const { data, error } = await supabaseAdmin
        .from("username_shares")
        .upsert(
          {
            owner_id: sessionUserId,
            recipient_id: friendId,
            owner_public_key: ownerProfile.public_key,
            encrypted_username: encryptedUsername,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_id,recipient_id" },
        )
        .select("id, owner_id, recipient_id, owner_public_key, encrypted_username, updated_at")
        .single();

      if (error) {
        const code = String((error as any).code || "");
        if (code === "42P01") return json({ error: "username_shares table missing" }, 500);
        return json({ error: "Failed to save username share", detail: error.message, code: (error as any).code }, 500);
      }

      return json({ data });
    }

    if (req.method === "POST" && isProfileUpsert) {
      const body = await req.json().catch(() => null) as {
        id?: string;
        publicKey?: string;
        encryptedUsername?: string | null;
      } | null;

      const id = body?.id?.trim().toLowerCase();
      const publicKey = body?.publicKey?.trim().toLowerCase();
      const encryptedUsername = body?.encryptedUsername ?? null;

      if (!id || !publicKey) return json({ error: "Missing id/publicKey" }, 400);
      if (!isHex(id) || !isHex(publicKey)) return json({ error: "Invalid hex input" }, 400);

      const expectedId = await sha256Hex(hexToUint8(publicKey));
      if (expectedId !== id) return json({ error: "id does not match publicKey hash" }, 400);

      const { data: existingProfile, error: existingErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      if (existingErr) {
        return json({ error: "Failed to read existing profile", detail: existingErr.message, code: (existingErr as any).code }, 500);
      }

      if (!existingProfile) {
        const { error: insertErr } = await supabaseAdmin
          .from("profiles")
          .insert({
            id,
            public_key: publicKey,
            encrypted_username: encryptedUsername,
          });

        if (insertErr) {
          return json({ error: "Failed to insert profile", detail: insertErr.message, code: (insertErr as any).code }, 500);
        }

        const { data: inserted, error: readInsertedErr } = await supabaseAdmin
          .from("profiles")
          .select("id, public_key, encrypted_username, created_at, updated_at")
          .eq("id", id)
          .single();

        if (readInsertedErr) {
          return json({ error: "Failed to read inserted profile", detail: readInsertedErr.message, code: (readInsertedErr as any).code }, 500);
        }

        return json({ data: inserted });
      }

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({
          public_key: publicKey,
          encrypted_username: encryptedUsername,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, public_key, encrypted_username, created_at, updated_at")
        .single();

      if (error) return json({ error: "Failed to upsert profile", detail: error.message, code: (error as any).code }, 500);
      return json({ data });
    }

    if (req.method === "POST" && isChallenge) {
      const body = await req.json().catch(() => null) as { userId?: string } | null;
      const userId = body?.userId?.trim().toLowerCase();
      if (!userId) return json({ error: "Missing userId" }, 400);

      const challengeLimit = await enforceRateLimit(
        supabaseAdmin,
        `${req.headers.get("cf-connecting-ip") || "unknown-ip"}:${userId}`,
        "challenge",
        60,
        15,
        300,
      );
      if (!challengeLimit.ok) {
        return json({ error: "Too many challenge requests", retry_after: challengeLimit.retryAfter || 60 }, 429);
      }

      const challenge = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const challengeHash = await sha256Hex(new TextEncoder().encode(challenge));
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const challengeId = crypto.randomUUID();

      const { error } = await supabaseAdmin.from("auth_challenges").insert([
        {
          id: challengeId,
          user_id: userId,
          challenge_hash: challengeHash,
          server_key_id: keyMaterial.keyId,
          expires_at: expiresAt,
        },
      ]);

      if (error) return json({ error: "Failed to create challenge", detail: error.message, code: (error as any).code }, 500);
      return json({
        challenge_id: challengeId,
        challenge,
        expires_at: expiresAt,
        server_public_key: toHex(serverPublic),
        server_key_id: keyMaterial.keyId,
      });
    }

    if (req.method === "POST" && (path === "/session/revoke" || path.endsWith("/session/revoke"))) {
      const token = req.headers.get("x-session-token")?.trim() || "";
      if (!token) return json({ error: "Missing session token" }, 400);
      const tokenHash = await sha256TextHex(token);

      const { error } = await supabaseAdmin
        .from("sessions")
        .delete()
        .eq("token_hash", tokenHash);

      if (error) return json({ error: "Failed to revoke session", detail: error.message, code: (error as any).code }, 500);
      return json({ success: true });
    }

    if (req.method !== "POST" || !isSignin) return new Response("Not found", { status: 404 });

    const body = await req.json().catch(() => null) as {
      challengeId?: string;
      publicKeyHex?: string;
      challenge?: string;
      challengeResponseHex?: string;
      timestamp?: number | string;
      serverKeyId?: string;
    } | null;

    if (!body) return json({ error: "Invalid JSON" }, 400);

    const { challengeId, publicKeyHex, challenge, challengeResponseHex, timestamp, serverKeyId } = body;
    if (!publicKeyHex || !challenge || !challengeResponseHex || !timestamp) {
      return json({ error: "Missing parameters" }, 400);
    }

    const ts = Number(timestamp);
    if (Number.isNaN(ts) || Math.abs(nowSeconds() - ts) > 120) {
      return json({ error: "Stale or invalid timestamp" }, 400);
    }

    let pubkey: Uint8Array;
    try {
      pubkey = hexToUint8(publicKeyHex);
    } catch {
      return json({ error: "Invalid public key hex" }, 400);
    }

    const profileId = await sha256Hex(pubkey);

    const signinLimit = await enforceRateLimit(
      supabaseAdmin,
      `${req.headers.get("cf-connecting-ip") || "unknown-ip"}:${profileId}`,
      "signin",
      60,
      20,
      300,
    );
    if (!signinLimit.ok) {
      return json({ error: "Too many signin attempts", retry_after: signinLimit.retryAfter || 60 }, 429);
    }

    const { data: challengeRows, error: cErr } = await supabaseAdmin
      .from("auth_challenges")
      .select("id, challenge_hash, server_key_id")
      .eq("user_id", profileId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (cErr) return json({ error: "Challenge lookup failed", detail: cErr.message, code: (cErr as any).code }, 500);
    if (!challengeRows || challengeRows.length === 0) return json({ error: "No active challenge" }, 401);

    const latestChallenge = challengeRows[0];
    if (challengeId && latestChallenge.id !== challengeId) {
      return json({ error: "Challenge id mismatch" }, 401);
    }

    const expectedChallengeHash = latestChallenge.challenge_hash;
    const expectedServerKeyId = latestChallenge.server_key_id || "legacy-default";
    if (serverKeyId && serverKeyId !== expectedServerKeyId) {
      return json({ error: "Server key mismatch" }, 401);
    }
    const providedChallengeHash = await sha256Hex(new TextEncoder().encode(challenge));
    if (providedChallengeHash !== expectedChallengeHash) return json({ error: "Challenge mismatch" }, 401);

    // Bitcoin-style possession proof over x25519 identity:
    // response = HMAC(sharedSecret, `${challenge}:${timestamp}`)
    // sharedSecret = nacl.box.before(userPublicKey, serverStaticPrivate)
    const sharedSecret = nacl.box.before(pubkey, serverPrivate);
    const expectedResponse = await hmacSha256Hex(sharedSecret, `${challenge}:${timestamp}`);

    if (expectedResponse !== challengeResponseHex.toLowerCase()) {
      return json({ error: "Invalid challenge response" }, 401);
    }

    let consumeQuery = supabaseAdmin
      .from("auth_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", latestChallenge.id)
      .is("consumed_at", null);

    const { error: consumeErr } = await consumeQuery;

    if (consumeErr) return json({ error: "Failed to consume challenge", detail: consumeErr.message, code: (consumeErr as any).code }, 500);

    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256TextHex(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: sessionErr } = await supabaseAdmin
      .from("sessions")
      .insert([{ user_id: profileId, token, token_hash: tokenHash, expires_at: expiresAt }]);

    if (sessionErr) {
      if ((sessionErr as any).code === "23503") return json({ error: "Profile not found" }, 404);
      return json({ error: "Failed to create session", detail: sessionErr.message, code: (sessionErr as any).code }, 500);
    }

    return json({ token, expires_at: expiresAt });
  } catch (err) {
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
