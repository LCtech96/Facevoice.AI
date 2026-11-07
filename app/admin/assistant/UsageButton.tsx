'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, X } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Consumi AI in piccolo accanto al titolo della Super chat (come il pulsante del
// consumo nella beta; prima era una riga in alto, e ancora prima la pagina Consumi):
// il pulsante mostra la spesa del mese, toccandolo si apre il dettaglio per funzione.
// Gemini fa il grosso, Claude subentra quando Gemini e' al limite. Si mostra solo la spesa
// registrata (niente promesse sul costo delle risposte).
// Senza il permesso dei consumi il pulsante non compare.

type Totals = {
  geminiCalls: number
  claudeCalls: number
  geminiLimits: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

type Data = {
  missingTable?: boolean
  month: Totals
  today: Totals
  lastLimitAt: string | null
  lastClaudeAt: string | null
  lastCallAt: string | null
  byFeature: (Totals & { feature: string })[]
}

const FEATURES: Record<string, string> = {
  chat_sito: 'Chat del sito',
  risposte_email: 'Risposte email',
  risposte_social: 'Risposte Instagram, Facebook, WhatsApp',
  controrisposte_clienti: 'Controrisposte ai clienti cercati',
  assistente_clienti: 'Super chat e assistente clienti',
  email_clienti: 'Email e follow-up ai clienti',
  analisi_clienti: 'Analisi dei siti dei clienti',
  traduzioni_sito: 'Traduzioni del sito',
  super_chat_carosello: 'Caroselli della super chat',
  super_chat_slide: 'Modifiche alle slide dei caroselli',
  super_chat_documenti: 'Documenti della super chat (contratti, preventivi)',
  altro: 'Altro',
}

const REFRESH_MS = 30_000
const usd = (v: number) => `$${v.toFixed(v > 0 && v < 1 ? 3 : 2)}`
const num = (v: number) => v.toLocaleString('it-IT')
const time = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const calls = (t: Totals) => t.geminiCalls + t.claudeCalls

export default function UsageButton() {
  const [data, setData] = useState<Data | null>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch('/api/admin/ai-usage', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res) return
    // Senza il permesso dei consumi il pulsante semplicemente non compare.
    if (res.status === 401 || res.status === 403) return setHidden(true)
    const json = await res.json().catch(() => null)
    if (res.ok && json) {
      setData(json)
      setLoadedAt(new Date())
    }
  }, [])

  // Ogni 30 secondi (ogni 5 con il dettaglio aperto), solo a pagina visibile.
  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, open ? 5_000 : REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, open])

  if (hidden || !data || data.missingTable) return null
  // Claude entra solo quando tutti i modelli Gemini sono al limite.
  const claudeNow = Boolean(data.lastClaudeAt && Date.now() - new Date(data.lastClaudeAt).getTime() < 2 * 60_000)
  const state = claudeNow ? 'Gemini è al limite: in questo momento risponde Claude.' : 'In questo momento risponde Gemini.'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          load()
        }}
        aria-label="Consumo dell’AI"
        aria-expanded={open}
        title={state}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2 py-1 text-xs font-semibold tabular-nums text-[var(--text-secondary)]"
      >
        <Coins className={`h-3.5 w-3.5 ${claudeNow ? 'text-[#FF9500]' : 'text-[var(--accent-blue)]'}`} />
        {usd(data.month.costUsd)}
      </button>
      {open && (
        <div className="fixed inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top,0px))] z-30 max-h-[60vh] overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm text-[var(--text-primary)] shadow-xl md:absolute md:inset-x-auto md:left-0 md:top-full md:mt-2 md:max-h-[70vh] md:w-80">
          <div className="flex items-center justify-between">
            <b>Consumo dell’AI</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Chiudi" className="p-1 text-[var(--text-secondary)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${claudeNow ? 'bg-[#FF9500]' : 'bg-[#34C759]'}`} />
            {state}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([['Oggi', data.today], ['Questo mese', data.month]] as const).map(([name, t]) => (
              <div key={name} className="rounded-xl bg-[var(--background-secondary)] p-2">
                <p className="text-xs text-[var(--text-secondary)]">{name}</p>
                <p className="text-base font-bold tabular-nums">{usd(t.costUsd)}</p>
                <p className="text-xs tabular-nums text-[var(--text-secondary)]">{num(t.inputTokens + t.outputTokens)} token</p>
                <p className="text-xs tabular-nums text-[var(--text-secondary)]">{num(calls(t))} richieste</p>
              </div>
            ))}
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {[
              ['Gemini nel mese', `${num(data.month.geminiCalls)} richieste`],
              ['Claude nel mese', `${num(data.month.claudeCalls)} · ${usd(data.month.costUsd)}`],
              ['Limiti Gemini', `${num(data.month.geminiLimits)}${data.lastLimitAt ? ` · ultimo ${time(data.lastLimitAt)}` : ''}`],
            ].map(([label, value]) => (
              <li key={label} className="flex justify-between gap-2">
                <span className="truncate text-[var(--text-secondary)]">{label}</span>
                <span className="shrink-0 tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-semibold text-[var(--text-secondary)]">Questo mese per funzione</p>
          {data.byFeature.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs">
              {data.byFeature.map((f) => (
                <li key={f.feature} className="flex justify-between gap-2">
                  <span className="truncate text-[var(--text-secondary)]">{FEATURES[f.feature] || f.feature}</span>
                  <span className="shrink-0 tabular-nums">
                    {num(calls(f))} · {usd(f.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Nessuna richiesta registrata questo mese.</p>
          )}
          <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
            {loadedAt ? `Aggiornato alle ${loadedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, si aggiorna da solo.` : ''}
            {data.lastCallAt ? ` Ultima richiesta ${time(data.lastCallAt)}.` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
