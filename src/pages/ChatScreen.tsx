import React, { useState } from 'react'
import MobileLayout from '../components/MobileLayout'
import ContactList from '../components/ContactList'
import MessageList from '../components/MessageList'
import MessageComposer from '../components/MessageComposer'

export default function ChatScreen(){
  const [contacts] = useState([{id:'alice',name:'Alice',last:'Hey'}, {id:'bob',name:'Bob',last:'See you'}])
  const [selected, setSelected] = useState<string | null>(contacts[0].id)
  const [messages, setMessages] = useState<Array<{id:string,from:string,text:string}>>([])

  function onSend(text:string){
    setMessages(m=>[...m, { id: String(Date.now()), from: 'me', text }])
    // TODO: hook into messaging stack to actually send encrypted envelope
  }

  return (
    <MobileLayout>
      <div className="flex h-full">
        <div className="w-1/3 border-r">
          <div className="p-3 font-bold">Contacts</div>
          <ContactList contacts={contacts} onSelect={id=>setSelected(id)} />
        </div>
        <div className="flex-1 flex flex-col">
          <div className="p-3 border-b font-bold">{contacts.find(c=>c.id===selected)?.name}</div>
          <MessageList messages={messages} />
          <MessageComposer onSend={onSend} />
        </div>
      </div>
    </MobileLayout>
  )
}
