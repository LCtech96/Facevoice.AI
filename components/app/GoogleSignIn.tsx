'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// "Continua con Google" direttamente sul nostro dominio: il pulsante ufficiale di
// Google (Google Identity Services) restituisce un token che passiamo a Supabase.
// Cosi' la schermata di Google mostra facevoice.ai e non l'indirizzo tecnico di
// Supabase. Se lo script di Google non si carica (o manca l'ID client), si usa il
// vecchio accesso con reindirizzamento.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || ''
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

type CredentialResponse = { credential?: string }
type GoogleId = {
  initialize: (options: Record<string, unknown>) => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
}
// Lettura senza dichiarazione globale: window.google e' gia' tipizzato per Google Maps altrove.
const gsiApi = () => (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id

function loadScript(): Promise<GoogleId> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const api = gsiApi()
      if (api) resolve(api)
      else reject(new Error('gsi'))
    }
    if (gsiApi()) return ready()
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', ready, { once: true })
    script.addEventListener('error', () => reject(new Error('gsi')), { once: true })
    setTimeout(() => reject(new Error('gsi timeout')), 8000)
  })
}

/** Nonce casuale: a Google va l'hash SHA-256, a Supabase il valore originale. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

export default function GoogleSignIn({
  disabled,
  onError,
  onBusy,
}: {
  disabled?: boolean
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}) {
  const supabase = createClient()
  const { language } = useTranslation()
  const slot = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'loading' | 'gsi' | 'redirect'>(CLIENT_ID ? 'loading' : 'redirect')

  useEffect(() => {
    if (!CLIENT_ID) return
    let alive = true
    ;(async () => {
      try {
        const [gsi, nonce] = await Promise.all([loadScript(), makeNonce()])
        if (!alive || !slot.current) return
        gsi.initialize({
          client_id: CLIENT_ID,
          nonce: nonce.hashed,
          ux_mode: 'popup',
          use_fedcm_for_button: true,
          callback: async (response: CredentialResponse) => {
            if (!response.credential) return onError('Accesso con Google non riuscito, riprova.')
            onBusy(true)
            const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: response.credential, nonce: nonce.raw })
            onBusy(false)
            if (error) {
              console.error('google id token:', error.message)
              onError(/not enabled|unsupported provider/i.test(error.message) ? 'L’accesso con Google non è ancora attivo: usa email e password.' : 'Accesso con Google non riuscito, riprova.')
            }
          },
        })
        const width = Math.min(400, Math.max(240, Math.round((slot.current.parentElement ?? slot.current).getBoundingClientRect().width)))
        gsi.renderButton(slot.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'center', width, locale: language === 'it' ? 'it' : 'en' })
        setMode('gsi')
      } catch {
        if (alive) setMode('redirect')
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const redirect = async () => {
    onBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app`, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      onBusy(false)
      onError(/not enabled|unsupported provider/i.test(error.message) ? 'L’accesso con Google non è ancora attivo: usa email e password.' : 'Accesso con Google non riuscito, riprova.')
    }
  }

  return (
    <div className={`mt-8 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <div ref={slot} className={mode === 'gsi' ? 'flex min-h-[44px] justify-center' : 'hidden'} />
      {mode === 'loading' && <div className="h-11 animate-pulse rounded-full bg-white/80" />}
      {mode === 'redirect' && (
        <button
          type="button"
          onClick={redirect}
          className="flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-semibold text-[#1f1f1f]"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Continua con Google
        </button>
      )}
    </div>
  )
}
