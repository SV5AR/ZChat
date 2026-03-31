import React from 'react'

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-[390px] h-[844px] bg-white rounded-2xl shadow-lg overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  )
}
