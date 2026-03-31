import React from 'react'

export default function MessageList({ messages }:{ messages: Array<{id:string,from:string,text:string}> }){
  return (
    <div className="flex-1 overflow-auto p-3 space-y-2">
      {messages.map(m=> (
        <div key={m.id} className={`max-w-[75%] p-3 rounded-lg ${m.from==='me' ? 'bg-blue-100 self-end ml-auto' : 'bg-gray-100'}`}>
          <div className="text-sm">{m.text}</div>
        </div>
      ))}
    </div>
  )
}
