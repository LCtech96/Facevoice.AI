'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

type AuthMode = 'signin' | 'signup' | 'verify'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!email || !email.includes('@')) {
      setError('Inserisci un indirizzo email valido')
      setLoading(false)
      return
    }

    if (!password || password.length < 6) {
      setError('La password deve contenere almeno 6 caratteri')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non corrispondono')
      setLoading(false)
      return
    }

    try {
      // Salva temporaneamente email e password (non crea l'utente ancora)
      const storeResponse = await fetch('/api/auth/store-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!storeResponse.ok) {
        const storeData = await storeResponse.json()
        throw new Error(storeData.error || 'Errore nel salvare la registrazione')
      }

      // Invia il codice OTP via email (senza creare l'utente in Supabase)
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const otpData = await response.json()

      if (!response.ok) {
        throw new Error(otpData.error || 'Errore nell\'invio del codice di verifica')
      }

      setMessage('Registrazione completata! Controlla la tua email per il codice di verifica.')
      setMode('verify')
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setError(err.message || 'Errore durante la registrazione')
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
      const response = await fetch('/api/auth/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Codice non valido')
      }

      // Dopo la verifica, accedi con la password (recuperata dalla risposta se presente, altrimenti usa quella salvata)
      const passwordToUse = data.password || password
      
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: passwordToUse,
      })

      if (signInError) {
        throw new Error('Errore nell\'accesso. Riprova a fare login manualmente.')
      }

      setMessage('Email verificata e accesso completato! Reindirizzamento in corso...')
      
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
    setLoading(true)

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
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setError(err.message || 'Errore nell\'invio del codice')
    } finally {
      setLoading(false)
    }
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!email || !email.includes('@')) {
      setError('Inserisci un indirizzo email valido')
      setLoading(false)
      return
    }

    if (!password) {
      setError('Inserisci la password')
      setLoading(false)
      return
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      if (data.user) {
        setMessage('Accesso completato! Reindirizzamento in corso...')
        setTimeout(() => {
          router.push('/ai-chat')
        }, 1000)
      }
    } catch (err: any) {
      setError(err.message || 'Email o password non corretti')
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
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
              {mode === 'signin' && 'Accedi'}
              {mode === 'signup' && 'Registrati'}
              {mode === 'verify' && 'Verifica Email'}
            </h1>
            <p className="text-[var(--text-secondary)]">
              {mode === 'signin' && 'Inserisci le tue credenziali per accedere'}
              {mode === 'signup' && 'Crea un nuovo account per iniziare'}
              {mode === 'verify' && `Inserisci il codice inviato a ${email}`}
            </p>
          </div>

          {/* Toggle Sign In / Sign Up - Solo quando non si sta verificando */}
          {mode !== 'verify' && (
            <div className="flex gap-2 mb-6 bg-[var(--background-secondary)] p-1 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('signin')
                  setError(null)
                  setMessage(null)
                  setPassword('')
                  setConfirmPassword('')
                }}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  mode === 'signin'
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Accedi
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup')
                  setError(null)
                  setMessage(null)
                  setPassword('')
                  setConfirmPassword('')
                }}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  mode === 'signup'
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Registrati
              </button>
            </div>
          )}

          {/* Sign In Form */}
          {mode === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="email-signin" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Indirizzo Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="email-signin"
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

              <div>
                <label htmlFor="password-signin" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="password-signin"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
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
                    <span>Accesso in corso...</span>
                  </>
                ) : (
                  <>
                    <span>Accedi</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </form>
          )}

          {/* Sign Up Form */}
          {mode === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label htmlFor="email-signup" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Indirizzo Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="email-signup"
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

              <div>
                <label htmlFor="password-signup" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="password-signup"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Almeno 6 caratteri"
                    className="w-full pl-10 pr-10 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all"
                    required
                    minLength={6}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Conferma Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ripeti la password"
                    className="w-full pl-10 pr-10 py-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all"
                    required
                    minLength={6}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
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
                    <span>Registrazione in corso...</span>
                  </>
                ) : (
                  <>
                    <span>Registrati</span>
                    <CheckCircle className="w-4 h-4" />
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
                    setMode('signup')
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
        </div>
      </motion.div>
    </div>
  )
}
