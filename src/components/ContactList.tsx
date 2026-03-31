import React from 'react'

export default function ContactList({ contacts, onSelect }:{ contacts: Array<{id:string,name:string,last:string}>, onSelect: (id:string)=>void }){
  return (
    <div className="flex-1 overflow-auto">
      {contacts.map(c=> (
        <button key={c.id} onClick={()=>onSelect(c.id)} className="w-full text-left px-4 py-3 border-b hover:bg-gray-50">
          <div className="font-medium">{c.name}</div>
          <div className="text-sm text-gray-500">{c.last}</div>
        </button>
      ))}
    </div>
  )
}
