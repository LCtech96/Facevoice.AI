'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Consumi AI in piccolo, in alto nella Super chat (prima era la pagina Consumi):
// una riga con oggi e il mese; toccandola si apre il dettaglio per funzione.
// Gemini (gratuito) fa il grosso, Claude subentra quando Gemini e' al limite.

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
  altro: 'Altro',
}

const REFRESH_MS = 30_000
const usd = (v: number) => `$${v.toFixed(v > 0 && v < 1 ? 3 : 2)}`
const num = (v: number) => v.toLocaleString('it-IT')
const time = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function UsageStrip() {
  const [data, setData] = useState<Data | null>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch('/api/admin/ai-usage', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res) return
    // Senza il permesso dei consumi la riga semplicemente non compare.
    if (res.status === 401 || res.status === 403) return setHidden(true)
    const json = await res.json().catch(() => null)
    if (res.ok && json) setData(json)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, open ? 5_000 : REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, open])

  if (hidden || !data || data.missingTable) return null
  // Claude entra solo quando tutti i modelli Gemini gratuiti sono al limite.
  const claudeNow = Boolean(data.lastClaudeAt && Date.now() - new Date(data.lastClaudeAt).getTime() < 2 * 60_000)

  return (
    <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--background)]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-1.5 text-[11px] text-[var(--text-secondary)]"
        title={claudeNow ? 'Gemini è al limite: in questo momento risponde Claude' : 'Gemini attivo: le risposte sono gratuite'}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${claudeNow ? 'bg-[#FF9500]' : 'bg-[#34C759]'}`} />
        <span className="truncate tabular-nums">
          Consumi AI · oggi {usd(data.today.costUsd)} · mese {usd(data.month.costUsd)}
          <span className="hidden sm:inline"> · {num(data.month.geminiCalls + data.month.claudeCalls)} richieste</span>
        </span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mx-auto max-h-[45vh] max-w-3xl overflow-y-auto px-4 pb-3">
          <p className="mb-2 text-[11px] text-[var(--text-secondary)]">
            {claudeNow ? 'Gemini è al limite: in questo momento risponde Claude.' : 'Gemini attivo: le risposte sono gratuite.'}
            {data.lastCallAt ? ` Ultima richiesta ${time(data.lastCallAt)}.` : ''}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Richieste oggi', num(data.today.geminiCalls + data.today.claudeCalls), `Claude ${num(data.today.claudeCalls)} · ${usd(data.today.costUsd)}`],
              ['Gemini nel mese', num(data.month.geminiCalls), 'Gratuito'],
              ['Claude nel mese', num(data.month.claudeCalls), `Spesa ${usd(data.month.costUsd)}`],
              ['Limiti Gemini', num(data.month.geminiLimits), data.lastLimitAt ? `Ultimo ${time(data.lastLimitAt)}` : 'Nessuno'],
            ].map(([label, value, hint]) => (
              <div key={label} className="min-w-0 rounded-lg bg-[var(--background-secondary)] px-2.5 py-2">
                <p className="text-[10px] text-[var(--text-secondary)]">{label}</p>
                <p className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
                <p className="truncate text-[10px] text-[var(--text-secondary)]">{hint}</p>
              </div>
            ))}
          </div>
          {data.byFeature.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-[var(--text-secondary)]">
                  <th className="py-1 font-normal">Funzione</th>
                  <th className="py-1 text-right font-normal">Richieste</th>
                  <th className="py-1 text-right font-normal">Spesa</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.map((f) => (
                  <tr key={f.feature} className="border-t border-[var(--border-color)] text-[var(--text-primary)]">
                    <td className="py-1.5 pr-2">{FEATURES[f.feature] || f.feature}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(f.geminiCalls + f.claudeCalls)}</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(f.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">Nessuna richiesta registrata questo mese.</p>
          )}
        </div>
      )}
    </div>
  )
}
