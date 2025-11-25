'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Redirect immediatamente alla AI Chat
    router.push('/ai-chat')
  }, [router])

  return (
    <main className="min-h-screen relative flex items-center justify-center">
      <div className="text-coral-red">Caricamento...</div>
    </main>
  )
}

