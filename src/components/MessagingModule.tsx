import React, { useState } from 'react'
import ChatScreen from '../pages/ChatScreen'

export default function MessagingModule(){
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">Messaging</div>
        <button onClick={()=>setOpen(o=>!o)} className="text-sm text-blue-600">{open ? 'Hide' : 'Open'}</button>
      </div>
      {open ? <ChatScreen /> : <div className="text-sm text-gray-500">Messaging UI hidden</div>}
    </div>
  )
}
