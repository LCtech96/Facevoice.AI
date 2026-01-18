'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { useTranslation } from '@/lib/i18n/LanguageContext'

type AuthMode = 'signin' | 'signup' | 'reset' | 'verify'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  googleOnly?: boolean
}

export default function AuthModal({ isOpen, onClose, onSuccess, googleOnly = false }: AuthModalProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (isOpen) {
      setMode('signin')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setVerificationCode('')
      setError(null)
      setMessage(null)
    }
  }, [isOpen])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      if (data.user) {
        onSuccess()
        onClose()
      }
    } catch (err: any) {
      setError(err.message || t('auth.loginError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!email || !email.includes('@')) {
      setError(t('auth.invalidEmail'))
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError(t('auth.passwordTooShort'))
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
        throw new Error(otpData.error || t('auth.signupError'))
      }

      setMessage(t('auth.registrationComplete'))
      setMode('verify')
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setError(err.message || t('auth.signupError'))
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
      setError(t('auth.codeLength'))
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
        throw new Error(data.error || t('auth.invalidCode'))
      }

      // Dopo la verifica, accedi con la password (recuperata dalla risposta se presente, altrimenti usa quella salvata)
      const passwordToUse = data.password || password
      
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: passwordToUse,
      })

      if (signInError) {
        throw new Error(t('auth.loginError'))
      }

      setMessage(t('auth.registrationComplete'))
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err.message || t('auth.invalidCode'))
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

      setMessage(t('auth.codeSent'))
      setTimeout(() => setMessage(null), 5000)
    } catch (err: any) {
      setError(err.message || 'Errore nell\'invio del codice')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/ai-chat`,
      })

      if (resetError) throw resetError

      setMessage('Email di recupero password inviata! Controlla la tua casella di posta.')
    } catch (err: any) {
      setError(err.message || 'Errore durante l\'invio della email di recupero')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (oauthError) throw oauthError
    } catch (err: any) {
      setError(err.message || 'Errore durante l\'accesso con Google')
      setLoading(false)
    }
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    if (mode === 'signin') {
      handleSignIn(e)
    } else if (mode === 'signup') {
      handleSignUp(e)
    } else if (mode === 'verify') {
      handleVerifyCode(e)
    } else {
      handlePasswordReset(e)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md glass-strong rounded-3xl p-8 border-2 border-coral-red/30"
      >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:glass rounded-lg transition-all"
          >
            <X className="w-5 h-5 text-coral-red" />
          </button>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-coral-red mb-2">
              {googleOnly ? t('auth.signIn') : mode === 'signin' && t('auth.signIn')}
              {!googleOnly && mode === 'signup' && t('auth.signUp')}
              {!googleOnly && mode === 'verify' && t('auth.verifyEmail')}
              {!googleOnly && mode === 'reset' && t('auth.resetPassword')}
            </h2>
            <p className="text-sm text-coral-red/70">
              {googleOnly ? t('auth.signIn') : mode === 'signin' && t('auth.signIn')}
              {!googleOnly && mode === 'signup' && t('auth.signUp')}
              {!googleOnly && mode === 'verify' && t('auth.enterCode')}
              {!googleOnly && mode === 'reset' && t('auth.resetPassword')}
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 glass rounded-lg border border-red-500/50"
            >
              <p className="text-sm text-red-400">{error}</p>
            </motion.div>
          )}

          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 glass rounded-lg border border-green-500/50"
            >
              <p className="text-sm text-green-400">{message}</p>
            </motion.div>
          )}

          <div className="space-y-4">
            {/* Google Sign In Button - Temporaneamente disabilitato */}
            {/* {mode === 'signin' && (
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 glass rounded-2xl hover:glass-strong transition-all border-2 border-transparent hover:border-coral-red/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 text-coral-red animate-spin" />
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span className="text-coral-red font-medium">Continua con Google</span>
                  </>
                )}
              </button>
            )} */}

            {!googleOnly && (
              <div>
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-coral-red/20" />
                  <span className="text-xs text-coral-red/50">oppure</span>
                  <div className="flex-1 h-px bg-coral-red/20" />
                </div>

                <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-coral-red/70 mb-2">
                  {t('auth.email')}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-coral-red/50" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 glass rounded-2xl text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all"
                    placeholder="nome@esempio.com"
                  />
                </div>
              </div>

              {mode === 'verify' && (
                <div>
                  <label className="block text-sm font-medium text-coral-red/70 mb-2">
                    {t('auth.verificationCode')}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      maxLength={6}
                      className="w-full pl-4 pr-4 py-3 glass rounded-2xl text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all text-center text-2xl tracking-widest font-mono"
                      placeholder="000000"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={loading}
                    className="mt-2 text-sm text-coral-red/70 hover:text-coral-red transition-colors"
                  >
                    {t('auth.resendCode')}
                  </button>
                </div>
              )}

              {mode !== 'reset' && mode !== 'verify' && (
                <div>
                  <label className="block text-sm font-medium text-coral-red/70 mb-2">
                    {t('auth.password')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-coral-red/50" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full pl-10 pr-4 py-3 glass rounded-2xl text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}

              {mode === 'signup' && (
                <div>
                  <label className="block text-sm font-medium text-coral-red/70 mb-2">
                    {t('auth.confirmPassword')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-coral-red/50" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full pl-10 pr-4 py-3 glass rounded-2xl text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 glass-strong rounded-2xl hover:border-coral-red border-2 border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed text-coral-red font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Caricamento...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {mode === 'signin' && 'Accedi'}
                      {mode === 'signup' && 'Registrati'}
                      {mode === 'verify' && 'Verifica'}
                      {mode === 'reset' && 'Invia Email'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
                </form>
              </div>
            )}

            {!googleOnly && (
              <div className="text-center space-y-2">
              {mode === 'signin' && (
                <>
                  <button
                    onClick={() => setMode('reset')}
                    className="text-sm text-coral-red/70 hover:text-coral-red transition-colors"
                  >
                    {t('auth.password')} dimenticata?
                  </button>
                  <p className="text-sm text-coral-red/50">
                    Non hai un account?{' '}
                    <button
                      onClick={() => setMode('signup')}
                      className="text-coral-red hover:underline font-medium"
                    >
                      Registrati
                    </button>
                  </p>
                </>
              )}
              {mode === 'signup' && (
                <p className="text-sm text-coral-red/50">
                  Hai già un account?{' '}
                  <button
                    onClick={() => setMode('signin')}
                    className="text-coral-red hover:underline font-medium"
                  >
                    Accedi
                  </button>
                </p>
              )}
              {mode === 'verify' && (
                <button
                  onClick={() => setMode('signin')}
                  className="text-sm text-coral-red/70 hover:text-coral-red transition-colors"
                >
                  Torna al login
                </button>
              )}
              {mode === 'reset' && (
                <button
                  onClick={() => setMode('signin')}
                  className="text-sm text-coral-red/70 hover:text-coral-red transition-colors"
                >
                  Torna al login
                </button>
              )}
              </div>
            )}
          </div>
      </motion.div>
    </div>
  )
}

