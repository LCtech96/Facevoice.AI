'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import { isAdminEmail } from '@/lib/admin-auth'

/** Solo l'admin: gli altri tornano alla home (le API rifiutano comunque). */
export function useAdminGate() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let alive = true
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!alive) return
        if (!user) router.replace('/auth')
        else if (!isAdminEmail(user.email)) router.replace('/home')
        else setAllowed(true)
      })
    return () => {
      alive = false
    }
  }, [router])
  return allowed
}
