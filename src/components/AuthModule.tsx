import React, { useState } from 'react'
import sessionManager from '../lib/sessionManager'

export default function AuthModule(){
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [msg, setMsg] = useState('')

  async function unlock(){
    try{
      await sessionManager.unlockStoreWithPin(pin)
      setUnlocked(true)
      setMsg('Unlocked')
    } catch (e){
      setMsg('Unlock failed')
    }
  }

  return (
    <div className="mb-4">
      <div className="font-medium mb-2">Auth</div>
      {unlocked ? (
        <div className="text-sm text-green-600">Store unlocked</div>
      ) : (
        <div className="flex gap-2 items-center">
          <input type="password" value={pin} onChange={e=>setPin(e.target.value)} placeholder="Enter PIN" className="px-3 py-2 border rounded" />
          <button onClick={unlock} className="px-3 py-2 bg-blue-600 text-white rounded">Unlock</button>
          <div className="text-sm text-gray-500">{msg}</div>
        </div>
      )}
    </div>
  )
}
