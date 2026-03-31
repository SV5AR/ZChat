import React, { useState } from 'react'

export default function MessageComposer({ onSend }:{ onSend:(txt:string)=>void }){
  const [text,setText] = useState('')
  return (
    <div className="p-3 border-t flex items-center gap-2">
      <input value={text} onChange={e=>setText(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border" placeholder="Type a message" />
      <button onClick={()=>{ if(text.trim()){ onSend(text.trim()); setText('') } }} className="bg-blue-600 text-white px-4 py-2 rounded-lg">Send</button>
    </div>
  )
}
