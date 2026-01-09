'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    router.push('/case-studies')
  }, [router])

  return (
    <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
      <div className="text-[var(--text-secondary)]">Loading...</div>
    </main>
  )
}

