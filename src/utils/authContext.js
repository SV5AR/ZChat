import { supabase } from "../supabaseClient";

const ENABLE_LEGACY_AUTH_RPC =
  String(import.meta.env.VITE_ENABLE_SET_AUTH_USER_RPC || "").toLowerCase() ===
  "true";

export async function setAuthUserContext(userId) {
  if (!userId || !ENABLE_LEGACY_AUTH_RPC) return;
  try {
    await supabase.rpc("set_auth_user", { user_uuid: userId });
  } catch (err) {
    // Optional legacy RPC; ignore if deployment does not expose it.
    if (err?.status !== 404) {
      console.warn("setAuthUserContext error:", err?.message);
    }
  }
}
