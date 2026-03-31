import React, { useState } from 'react'
import session from '../lib/session'
import messaging from '../lib/messaging'

export default function MessagingModule() {
  const [pin, setPin] = useState('')
  const [toUuid, setToUuid] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle')

  async function onSend() {
    setStatus('unlocking')
    const privs = await session.unlockSession(pin)
    if (!privs) return setStatus('unlock-failed')
    setStatus('creating-packet')
    const fromUuid = 'local-uuid-placeholder'
    const pkt = await messaging.createEncryptedPacket(text, toUuid, fromUuid, privs)
    setStatus('sending')
    const relay = (import.meta.env.VITE_RELAY_URL as string) || '/relay'
    await messaging.sendPacket(relay, pkt)
    setStatus('sent')
  }

  return (
    <section className="mb-6">
      <h2 className="font-medium">Messaging Module</h2>
      <div className="mt-2 space-y-2">
        <input placeholder="Recipient UUID" value={toUuid} onChange={e=>setToUuid(e.target.value)} className="w-full p-2 border rounded" />
        <textarea placeholder="Message" value={text} onChange={e=>setText(e.target.value)} className="w-full p-2 border rounded" />
        <input placeholder="Unlock PIN" value={pin} type="password" onChange={e=>setPin(e.target.value)} className="w-full p-2 border rounded" />
        <div className="flex gap-2">
          <button onClick={onSend} className="bg-blue-600 text-white px-3 py-1 rounded">Send</button>
          <div className="text-sm text-gray-500">Status: {status}</div>
        </div>
      </div>
    </section>
  )
}
