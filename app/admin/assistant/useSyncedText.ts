'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Salvataggi in sospeso di tutte le schede (per salvarli prima di cambiare chat). */
const pending = new Set<() => Promise<unknown>>()

/**
 * Salva subito tutti i testi in sospeso delle schede e aspetta che arrivino al server.
 * Va chiamato PRIMA di cambiare chat: dopo, le schede di prima non esistono piu'.
 */
export function flushSyncedTexts() {
  return Promise.all([...pending].map((flush) => flush().catch(() => undefined)))
}

/**
 * Testo modificabile di una scheda della chat (didascalia, messaggio): si scrive in
 * locale e si salva nella conversazione dopo una breve pausa, non a ogni tasto.
 * Mentre si scrive un aggiornamento dal server non lo sovrascrive.
 * flush() salva subito (prima di pubblicare o inviare).
 */
export function useSyncedText(value: string, save: (text: string) => unknown, delay = 600) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(value)
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback((): Promise<unknown> => {
    pending.delete(flush)
    if (!timer.current) return Promise.resolve()
    clearTimeout(timer.current)
    timer.current = null
    return Promise.resolve(saveRef.current(latest.current))
  }, [])

  useEffect(() => {
    if (!timer.current) {
      latest.current = value
      setText(value)
    }
  }, [value])

  // Scheda chiusa con una modifica in sospeso (es. diventa una versione di prima): si
  // salva lo stesso. Per il cambio di chat si salva prima, con flushSyncedTexts().
  useEffect(
    () => () => {
      void flush()
    },
    [flush]
  )

  const change = useCallback(
    (next: string) => {
      setText(next)
      latest.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
      pending.add(flush)
    },
    [flush, delay]
  )

  return [text, change, flush] as const
}
