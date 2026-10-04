'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { CheckCircle2, Loader2, Mic, Square, X } from 'lucide-react'

// Modulo "Parliamo del tuo progetto": nome, cognome, email, cellulare e un
// breve messaggio, anche dettato a voce (riconoscimento vocale del browser).

type Props = { open: boolean; onClose: () => void }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

const EMPTY = { firstName: '', lastName: '', email: '', phone: '', message: '', website: '' }

export default function ContactModal({ open, onClose }: Props) {
  const [form, setForm] = useState(EMPTY)
  const [privacy, setPrivacy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Testo gia' presente quando si avvia la dettatura: il parlato si aggiunge in coda.
  const baseTextRef = useRef('')

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    setSpeechSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition))
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      recognitionRef.current?.stop()
    }
  }, [open, onClose])

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const toggleDictation = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'it-IT'
    recognition.continuous = true
    recognition.interimResults = true
    baseTextRef.current = form.message ? `${form.message.trimEnd()} ` : ''
    recognition.onresult = (event) => {
      let finalText = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interim += result[0].transcript
      }
      setForm((f) => ({ ...f, message: `${baseTextRef.current}${finalText}${interim}`.slice(0, 3000) }))
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') setError('Consenti l’uso del microfono per dettare il messaggio.')
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setError(null)
    recognition.start()
    setListening(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    recognitionRef.current?.stop()
    setError(null)
    if (!privacy) return setError('Per inviare serve il consenso al trattamento dei dati.')
    setStatus('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, privacy }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Invio non riuscito')
      setStatus('sent')
      setForm(EMPTY)
      setPrivacy(false)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : 'Invio non riuscito')
    }
  }

  const close = () => {
    onClose()
    // Dopo la chiusura il modulo torna pronto per un nuovo invio.
    setTimeout(() => setStatus('idle'), 300)
  }

  if (!open || typeof document === 'undefined') return null

  const input =
    'w-full rounded-xl border border-white/15 bg-black/30 px-3.5 py-3 text-[16px] text-white placeholder:text-white/40 outline-none focus:border-[#ff8a1f] transition-colors'

  return createPortal(
    <div className="ember-vars fixed inset-0 z-[200] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="contact-title">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} aria-label="Chiudi" />

      <div
        className="relative w-full sm:max-w-lg max-h-[92svh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/15 bg-[#1a0702] px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-7 text-white shadow-2xl"
        style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
      >
        <button onClick={close} className="absolute right-4 top-4 rounded-full p-2 text-white/60 hover:bg-white/10" aria-label="Chiudi">
          <X className="h-5 w-5" />
        </button>

        {status === 'sent' ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#ff8a1f]" />
            <h2 className="mt-4 text-2xl font-semibold" style={{ fontFamily: 'var(--font-inter-tight), sans-serif' }}>
              Messaggio inviato!
            </h2>
            <p className="mt-2 text-white/70">
              Il team di Facevoice AI ti ricontatterà a breve. Ti abbiamo mandato una email di conferma.
            </p>
            <button
              onClick={close}
              className="mt-6 rounded-full bg-gradient-to-r from-[#ff3d00] to-[#ff8a1f] px-6 py-3 font-semibold"
            >
              Chiudi
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="pr-8">
              <h2 id="contact-title" className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-inter-tight), sans-serif' }}>
                Parliamo del tuo progetto
              </h2>
              <p className="mt-1 text-sm text-white/60">Lasciaci i tuoi contatti: ti richiamiamo noi.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="Nome" autoComplete="given-name" required value={form.firstName} onChange={set('firstName')} />
              <input className={input} placeholder="Cognome" autoComplete="family-name" required value={form.lastName} onChange={set('lastName')} />
            </div>
            <input className={input} type="email" placeholder="Email" autoComplete="email" inputMode="email" required value={form.email} onChange={set('email')} />
            <input className={input} type="tel" placeholder="Cellulare" autoComplete="tel" inputMode="tel" required value={form.phone} onChange={set('phone')} />

            <div className="relative">
              <textarea
                className={`${input} min-h-[120px] resize-none ${speechSupported ? 'pr-14' : ''}`}
                placeholder={speechSupported ? 'Di cosa hai bisogno? Scrivi o premi il microfono e parla' : 'Di cosa hai bisogno? Raccontacelo in breve'}
                required
                maxLength={3000}
                value={form.message}
                onChange={set('message')}
              />
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  className={`absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                    listening ? 'bg-[#ff3d00] text-white animate-pulse' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                  aria-label={listening ? 'Ferma la dettatura' : 'Detta il messaggio con la voce'}
                  aria-pressed={listening}
                >
                  {listening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
                </button>
              )}
            </div>
            {listening && <p className="text-xs text-[#ffb27a]">Ti ascolto… parla pure, poi premi il quadrato per fermare.</p>}

            {/* Campo esca per i bot: nascosto alle persone. */}
            <input type="text" tabIndex={-1} autoComplete="off" className="hidden" value={form.website} onChange={set('website')} aria-hidden="true" />

            <label className="flex items-start gap-2.5 text-xs text-white/60">
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#ff6a1a]" />
              <span>
                Acconsento al trattamento dei miei dati per essere ricontattato, come descritto nella{' '}
                <Link href="/privacy" className="underline" target="_blank">
                  privacy policy
                </Link>
                .
              </span>
            </label>

            {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff3d00] to-[#ff8a1f] py-3.5 font-semibold shadow-[0_14px_40px_rgba(255,61,0,0.38)] disabled:opacity-60"
            >
              {status === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === 'sending' ? 'Invio…' : 'Invia richiesta'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
