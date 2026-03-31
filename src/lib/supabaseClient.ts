import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabase: SupabaseClient | null = null

export function initSupabase(url: string, key: string){
  supabase = createClient(url, key)
  return supabase
}

export function getSupabase(){
  if(!supabase) throw new Error('Supabase not initialized')
  return supabase
}

export async function publishEnvelope(table:string, envelope:any){
  const sb = getSupabase()
  return await sb.from(table).insert([envelope])
}

export async function subscribeToEnvelopes(table:string, onRecord:(rec:any)=>void){
  const sb = getSupabase()
  const channel = sb.channel('envelopes')
  channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
    onRecord(payload.record)
  })
  channel.subscribe()
  return () => channel.unsubscribe()
}

export async function fetchPrekeyById(id: string) {
  const sb = getSupabase()
  const res = await sb.from('prekeys').select('*').eq('id', id).limit(1)
  if (res && (res as any).data && (res as any).data.length) return (res as any).data[0]
  return null
}
