'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Lock, ArrowRight, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'

type Status = 'checking' | 'ready' | 'invalid' | 'done'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  // Il link di recupero porta con se' la sessione: in hash (#access_token)
  // oppure come ?code= da scambiare. Gestiamo entrambi i casi.
  useEffect(() => {
    let cancelled = false

    const resolveSession = async () => {
      const hash = window.location.hash
      const params = new URLSearchParams(window.location.search)

      const hashError = hash.includes('error_description')
      if (hashError) {
        if (!cancelled) setStatus('invalid')
        return
      }

      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          if (!cancelled) setStatus('invalid')
          return
        }
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setStatus(data.session ? 'ready' : 'invalid')
    }

    // detectSessionInUrl puo' arrivare un attimo dopo il primo render:
    // l'evento ci dice quando la sessione di recupero e' pronta.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) setStatus((prev) => (prev === 'done' ? prev : 'ready'))
    })

    resolveSession()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('La password deve contenere almeno 6 caratteri')
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non corrispondono')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setStatus('done')
      setTimeout(() => router.push('/ai-chat'), 1500)
    } catch (err: any) {
      setError(err.message || 'Impossibile aggiornare la password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-8 shadow-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
              Nuova password
            </h1>
            <p className="text-[var(--text-secondary)]">
              {status === 'checking' && 'Verifica del link in corso...'}
              {status === 'ready' && 'Scegli una nuova password per il tuo account'}
              {status === 'invalid' && 'Questo link non e’ piu’ valido'}
              {status === 'done' && 'Password aggiornata'}
            </p>
          </div>

          {status === 'checking' && (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)] rounded-full animate-spin" />
            </div>
          )}

          {status === 'invalid' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Il link e&apos; scaduto o e&apos; gia&apos; stato usato. I link di recupero
                  valgono una volta sola e per un tempo limitato.
                </span>
              </div>
              <button
                onClick={() => router.push('/auth')}
                className="w-full bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-light)] text-white py-3 px-4 rounded-lg font-medium transition-all"
              >
                Richiedi un nuovo link
              </button>
            </div>
          )}

          {status === 'done' && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>Password aggiornata. Ti stiamo portando alla chat...</span>
            </div>
          )}

          {status === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Nuova password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Almeno 6 caratteri"
                    autoComplete="new-password"
                    className="w-full pl-11 pr-11 py-3 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-new-password"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Conferma password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="confirm-new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ripeti la password"
                    autoComplete="new-password"
                    className="w-full pl-11 pr-4 py-3 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm"
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}

              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-light)] text-white py-3 px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Aggiornamento...</span>
                  </>
                ) : (
                  <>
                    <span>Imposta password</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
