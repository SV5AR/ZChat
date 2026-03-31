import React from 'react'
import AuthModule from './components/AuthModule'
import CryptoModule from './components/CryptoModule'
import MessagingModule from './components/MessagingModule'
import SyncModule from './components/SyncModule'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Bitcoin Messaging App (scaffold)</h1>
        <AuthModule />
        <CryptoModule />
        <MessagingModule />
        <SyncModule />
      </div>
    </div>
  )
}

