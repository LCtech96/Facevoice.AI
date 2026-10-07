'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAccessToken } from '@/lib/session-token'

// Consumo delle AI che lavorano da sole: chat del sito, risposte email e social,
// Ricerca clienti. Gemini (gratuito) fa il grosso, Claude subentra quando Gemini e' al limite.

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
  assistente_clienti: 'Assistente Ricerca clienti',
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[var(--background-secondary)] p-3 min-w-0">
      <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
      <p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-secondary)] truncate">{hint}</p>}
    </div>
  )
}

export default function AutomationUsage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    try {
      const res = await fetch('/api/admin/ai-usage', { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore')
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore')
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  return (
    <section className="mb-8 p-4 bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI automatiche del sito</h2>
        <p className="text-[11px] text-[var(--text-secondary)]">Chat del sito, risposte e Ricerca clienti · si aggiorna da sola</p>
      </div>

      {error && <p className="text-sm text-[#FF3B30]">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--text-secondary)]">Carico…</p>}

      {data?.missingTable && (
        <p className="text-sm text-[var(--text-secondary)]">
          Il conteggio non è ancora attivo: manca la tabella <code>ai_usage</code> su Supabase.
        </p>
      )}

      {data && !data.missingTable && (
        <>
          <StatusLine data={data} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <Stat label="Richieste oggi" value={num(data.today.geminiCalls + data.today.claudeCalls)} hint={`Claude: ${num(data.today.claudeCalls)} · ${usd(data.today.costUsd)}`} />
            <Stat label="Gemini questo mese" value={num(data.month.geminiCalls)} hint="Gratuito" />
            <Stat label="Claude questo mese" value={num(data.month.claudeCalls)} hint={`Spesa ${usd(data.month.costUsd)}`} />
            <Stat label="Limiti Gemini raggiunti" value={num(data.month.geminiLimits)} hint={data.lastLimitAt ? `Ultimo ${time(data.lastLimitAt)}` : 'Nessuno'} />
          </div>

          {data.byFeature.length > 0 ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-left text-[11px] text-[var(--text-secondary)]">
                    <th className="font-normal px-1 py-1">Funzione</th>
                    <th className="font-normal px-1 py-1 text-right">Gemini</th>
                    <th className="font-normal px-1 py-1 text-right">Claude</th>
                    <th className="font-normal px-1 py-1 text-right">Token</th>
                    <th className="font-normal px-1 py-1 text-right">Spesa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byFeature.map((f) => (
                    <tr key={f.feature} className="border-t border-[var(--border-color)] text-[var(--text-primary)]">
                      <td className="px-1 py-2">{FEATURES[f.feature] || f.feature}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{num(f.geminiCalls)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{num(f.claudeCalls)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{num(f.inputTokens + f.outputTokens)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{usd(f.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">Nessuna richiesta registrata questo mese.</p>
          )}
        </>
      )}
    </section>
  )
}

function StatusLine({ data }: { data: Data }) {
  // Claude entra solo quando tutti i modelli Gemini gratuiti sono al limite.
  const limitedNow = data.lastClaudeAt && Date.now() - new Date(data.lastClaudeAt).getTime() < 2 * 60_000
  return (
    <p className="flex items-center gap-2 text-xs mb-3 text-[var(--text-secondary)]">
      <span className={`inline-block w-2 h-2 rounded-full ${limitedNow ? 'bg-[#FF9500]' : 'bg-[#34C759]'}`} />
      {limitedNow ? 'Gemini è al limite: in questo momento risponde Claude.' : 'Gemini attivo: le risposte sono gratuite.'}
      {data.lastCallAt && <span className="ml-auto">Ultima richiesta {time(data.lastCallAt)}</span>}
    </p>
  )
}
