import React, { useEffect, useRef, useState } from 'react'

export default function AuthModule() {
  const workerRef = useRef<Worker | null>(null)
  const [mnemonic, setMnemonic] = useState<string>('')
  const [words, setWords] = useState<12 | 24>(12)
  const [pubKeys, setPubKeys] = useState<{ x25519?: string; ed25519?: string }>({})
  const [uuid] = useState(() => (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : 'uuid-placeholder')
  const [status, setStatus] = useState<string>('idle')

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL('../workers/crypto.worker.ts', import.meta.url), { type: 'module' })
      const w = workerRef.current
      w.addEventListener('message', (ev) => {
        const data = ev.data || {}
        if (data.type === 'mnemonic') {
          setMnemonic(data.mnemonic)
          setStatus('mnemonic-generated')
        } else if (data.type === 'derived') {
          setPubKeys(data.publicKeys)
          setStatus('derived')
        } else if (data.type === 'error') {
          const msg = data.message || 'worker error'
          setStatus('error: ' + msg)
        }
      })
      w.addEventListener('error', (ev) => {
        setStatus('worker runtime error')
      })
      return () => w.terminate()
    } catch (err: any) {
      setStatus('worker creation failed')
    }
  }, [])

  function onGenerate() {
    setStatus('generating')
    workerRef.current?.postMessage({ type: 'generate-mnemonic', payload: { words } })
  }

  function onDerive() {
    if (!mnemonic) return setStatus('no mnemonic')
    setStatus('deriving')
    ;(async () => {
      try {
        const mod = await import('../lib/crypto')
        const keys = await mod.deriveFromMnemonic(mnemonic)
        const toHex = (b: Uint8Array) => Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('')
        setPubKeys({ x25519: toHex(keys.x25519.pub), ed25519: toHex(keys.ed25519.pub) })
        setStatus('derived')
      } catch (err: any) {
        setStatus('error: ' + (err?.message || String(err)))
      }
    })()
  }

  return (
    <section className="mb-6">
      <h2 className="font-medium">Auth Module</h2>
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-sm">Words:</label>
          <select value={String(words)} onChange={(e) => setWords(Number(e.target.value) as 12 | 24)} className="border px-2 py-1 rounded">
            <option value="12">12</option>
            <option value="24">24</option>
          </select>
          <button onClick={onGenerate} className="ml-2 bg-blue-600 text-white px-3 py-1 rounded">Generate</button>
          <button onClick={onDerive} className="ml-2 bg-green-600 text-white px-3 py-1 rounded">Derive Keys</button>
        </div>

        <div>
          <label className="text-xs text-gray-500">Mnemonic</label>
          <textarea readOnly value={mnemonic} className="w-full mt-1 p-2 bg-white rounded border" rows={3} />
        </div>

        <div>
          <label className="text-xs text-gray-500">UUID</label>
          <div className="mt-1 font-mono text-sm">{uuid}</div>
        </div>

        <div>
          <label className="text-xs text-gray-500">Public Keys</label>
          <div className="mt-1 font-mono text-sm break-all">x25519: {pubKeys.x25519 ?? '-'}</div>
          <div className="font-mono text-sm break-all">ed25519: {pubKeys.ed25519 ?? '-'}</div>
        </div>

        <div className="text-sm text-gray-500">Status: {status}</div>
      </div>
    </section>
  )
}
