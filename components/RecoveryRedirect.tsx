'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

const RESET_PATH = '/auth/reset-password'

/**
 * Porta i link di recupero password sulla pagina giusta.
 *
 * Supabase manda il link al suo endpoint /verify, che poi rimanda al
 * sito. Se il redirect non e' stato specificato — succede con le email
 * inviate dalla dashboard Supabase — la destinazione e' il Site URL,
 * cioe' la home. L'utente si ritrova loggato ma senza modo di scegliere
 * una nuova password.
 *
 * Questo componente sta nel layout, quindi vede quel caso ovunque
 * atterri e reindirizza.
 */
export default function RecoveryRedirect() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === RESET_PATH) return

    // L'URL va letto PRIMA di creare il client: con detectSessionInUrl
    // attivo, Supabase consuma il frammento e lo cancella.
    const hash = window.location.hash
    const search = window.location.search

    // Il tipo 'recovery' puo' stare nel frammento (#type=recovery...)
    // oppure fra i parametri, a seconda del flusso configurato.
    const isRecoveryLink =
      hash.includes('type=recovery') || new URLSearchParams(search).get('type') === 'recovery'

    const supabase = createClient()

    if (isRecoveryLink) {
      // Il frammento viaggia con la redirezione: la pagina di reset
      // deve poterlo leggere per aprire la sessione.
      router.replace(`${RESET_PATH}${search}${hash}`)
      return
    }

    // Se il client Supabase ha gia' consumato il frammento prima di noi,
    // l'evento resta l'unico segnale disponibile.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace(RESET_PATH)
      }
    })

    return () => subscription.unsubscribe()
  }, [pathname, router])

  return null
}
