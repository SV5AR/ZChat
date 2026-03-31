import React, { useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'
import localEncryptedDB from '../lib/localEncryptedDB'

export default function SyncModule() {
  const [status, setStatus] = useState('disconnected')
  const [lastPacket, setLastPacket] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return setStatus('no-client')

    setStatus('connecting')

    // Example: subscribe to inserts on `packets` table
    const subscription = supabase
      .channel('public:packets')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'packets' }, (payload) => {
        const pkt = payload.new;
        setLastPacket(JSON.stringify(pkt));
        // Cache the encrypted envelope locally (table 'packets') for offline access
        (async () => {
          try {
            // Use a temporary key derived from a well-known salt for now; real key comes from user session
            const tempKey = await localEncryptedDB.deriveKeyFromPassword('local-temp-key', new Uint8Array([1,2,3,4,5,6,7,8]));
            await localEncryptedDB.encryptAndStore('packets', pkt.id, pkt, tempKey)
          } catch (e) {
            // ignore caching errors silently
          }
        })();
        setStatus('received');
      })
      .subscribe((statusObj) => {
        if (statusObj === 'SUBSCRIBED') setStatus('connected')
      })

    return () => {
      try { supabase.removeChannel(subscription) } catch (e) {}
    }
  }, [])

  return (
    <section className="mb-6">
      <h2 className="font-medium">Sync Module</h2>
      <p className="text-sm text-gray-600">Status: {status}</p>
      <div className="mt-2 text-xs font-mono break-words max-h-40 overflow-auto bg-white p-2 rounded border">{lastPacket ?? 'no packets yet'}</div>
    </section>
  )
}
