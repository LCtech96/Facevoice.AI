'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, CheckCircle, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

type AuthMode = 'email' | 'verify' | 'success'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('email')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    // Check if user is already authenticated
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
        router.push('/ai-chat')
      }
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        router.push('/ai-chat')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!email || !email.includes('@')) {
      setError('Inserisci un indirizzo email valido')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Errore nell\'invio del codice')
      }

      setMessage('Codice di verifica inviato! Controlla la tua email.')
      setMode('verify')
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setError(err.message || 'Errore nell\'invio del codice')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!verificationCode || verificationCode.length !== 6) {
      setError('Inserisci un codice di 6 cifre')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Codice non valido')
      }

      // Se la verifica ha successo, autentica l'utente con Supabase
      if (data.magicLink) {
        // Usa il magic link per creare la sessione
        // Estrai il token dal link
        const url = new URL(data.magicLink)
        const token = url.searchParams.get('token')
        const type = url.searchParams.get('type')

        if (token && type === 'magiclink') {
          // Usa il token per autenticare
          const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: 'magiclink',
          })

          if (sessionError) {
            console.warn('Session error:', sessionError)
            // Fallback: prova con password temporanea se disponibile (solo dev)
            if (data.tempPassword) {
              const { error: pwdError } = await supabase.auth.signInWithPassword({
                email,
                password: data.tempPassword,
              })
              if (pwdError) {
                throw new Error('Errore nell\'autenticazione. Riprova.')
              }
            }
          }
        }
      } else if (data.tempPassword && process.env.NODE_ENV === 'development') {
        // Fallback per sviluppo: usa password temporanea
        const { error: pwdError } = await supabase.auth.signInWithPassword({
          email,
          password: data.tempPassword,
        })
        if (pwdError) {
          throw new Error('Errore nell\'autenticazione. Riprova.')
        }
      }

      setMessage('Verifica completata! Accesso in corso...')
      setMode('success')

      // Attendi un momento e reindirizza
      setTimeout(() => {
        router.push('/ai-chat')
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Codice non valido. Riprova.')
      setVerificationCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    setError(null)
    setMessage(null)
    await handleSendCode(new Event('submit') as any)
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-8 shadow-xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
              {mode === 'email' && 'Accedi o Registrati'}
              {mode === 'verify' && 'Verifica Email'}
              {mode === 'success' && 'Accesso Completato!'}
            </h1>
            <p className="text-[var(--text-secondary)]">
              {mode === 'email' && 'Inserisci la tua email per ricevere il codice di verifica'}
              {mode === 'verify' && `Inserisci il codice inviato a ${email}`}
              {mode === 'success' && 'Stai per essere reindirizzato alla chat...'}
            </p>
          </div>

          {/* Email Input Form */}
          {mode === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Indirizzo Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@esempio.com"
                    className="w-full pl-10 pr-4 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{error}</span>
                </motion.div>
              )}

              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{message}</span>
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
                    <span>Invio in corso...</span>
                  </>
                ) : (
                  <>
                    <span>Invia Codice</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </form>
          )}

          {/* Verification Code Form */}
          {mode === 'verify' && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Codice di Verifica (6 cifre)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="code"
                    type="text"
                    value={verificationCode}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                      setVerificationCode(value)
                    }}
                    placeholder="000000"
                    className="w-full pl-10 pr-4 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all text-center text-2xl tracking-widest font-mono"
                    maxLength={6}
                    required
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{error}</span>
                </motion.div>
              )}

              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{message}</span>
                </motion.div>
              )}

              <div className="flex gap-3">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setMode('email')
                    setVerificationCode('')
                    setError(null)
                    setMessage(null)
                  }}
                  className="flex-1 py-3 px-4 bg-[var(--background-secondary)] hover:bg-[var(--background)] text-[var(--text-primary)] rounded-lg font-medium transition-all border border-[var(--border-color)]"
                >
                  Indietro
                </motion.button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={loading || verificationCode.length !== 6}
                  className="flex-1 flex items-center justify-center gap-2 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-light)] text-white py-3 px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Verifica...</span>
                    </>
                  ) : (
                    <>
                      <span>Verifica</span>
                      <CheckCircle className="w-4 h-4" />
                    </>
                  )}
                </motion.button>
              </div>

              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="w-full text-center text-sm text-[var(--accent-blue)] hover:underline disabled:opacity-50"
              >
                Non hai ricevuto il codice? Invia di nuovo
              </button>
            </form>
          )}

          {/* Success State */}
          {mode === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring' }}
                className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center"
              >
                <CheckCircle className="w-8 h-8 text-green-500" />
              </motion.div>
              <p className="text-[var(--text-secondary)]">Accesso completato con successo!</p>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

