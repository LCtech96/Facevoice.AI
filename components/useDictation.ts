'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Dettatura con il riconoscimento vocale del browser (Chrome, Edge, Safari su
// iPhone/Mac). Il testo detto si aggiunge al campo: lo si controlla e poi si invia.

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
}

function createRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null
  const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  const Impl = Ctor.SpeechRecognition || Ctor.webkitSpeechRecognition
  return Impl ? new Impl() : null
}

export function useDictation(onText: (text: string) => void, lang = 'it-IT') {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  useEffect(() => {
    setSupported(Boolean(createRecognition()))
    return () => recRef.current?.stop()
  }, [])

  const stop = useCallback(() => recRef.current?.stop(), [])

  const start = useCallback(() => {
    const rec = createRecognition()
    if (!rec) return
    setError(null)
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript
      if (text.trim()) onTextRef.current(text.trim())
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Consenti l’uso del microfono per dettare.')
      else if (e.error !== 'aborted' && e.error !== 'no-speech') setError('Dettatura interrotta, riprova.')
    }
    rec.onend = () => setListening(false)
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [lang])

  return { supported, listening, error, start, stop, toggle: () => (listening ? stop() : start()) }
}
