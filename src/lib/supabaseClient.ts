import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let supabase: SupabaseClient | null = null

export function getSupabaseClient() {
  if (supabase) return supabase
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase env not defined (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)')
    return null
  }
  supabase = createClient(supabaseUrl, supabaseAnonKey)
  return supabase
}
