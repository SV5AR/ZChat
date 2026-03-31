import React, { useState, useEffect } from 'react'
import MobileLayout from '../components/MobileLayout'
import ContactList from '../components/ContactList'
import MessageList from '../components/MessageList'
import MessageComposer from '../components/MessageComposer'
import messaging from '../lib/messaging'
import { initSupabase } from '../lib/supabaseClient'

export default function ChatScreen(){
  const [contacts] = useState([{id:'alice',name:'Alice',last:'Hey'}, {id:'bob',name:'Bob',last:'See you'}])
  const [selected, setSelected] = useState<string | null>(contacts[0].id)
  const [messages, setMessages] = useState<Array<{id:string,from:string,text:string}>>([])

  function onSend(text:string){
    setMessages(m=>[...m, { id: String(Date.now()), from: 'me', text }])
    // send via messaging bridge
    try { messaging.sendMessage(selected || 'broadcast', text).catch(()=>{}) } catch (e) {}
  }

  useEffect(()=>{
    // initialize supabase from env (set via runtime) - fallback no-op
    const url = (import.meta.env.VITE_SUPABASE_URL as string) || ''
    const key = (import.meta.env.VITE_SUPABASE_KEY as string) || ''
    if(url && key) initSupabase(url, key)
    const unsub = messaging.subscribe((m:any)=>{
      setMessages(ms=>[...ms, { id: String(Date.now())+Math.random(), from: m.from, text: m.text }])
    })
    return () => { try { unsub && unsub() } catch (e) {} }
  }, [])

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
