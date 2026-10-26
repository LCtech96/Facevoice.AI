'use client'

import { useState } from 'react'
import { Languages } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Traduzione di un messaggio solo per leggerlo (es. un commento in russo):
// si tocca il messaggio e si sceglie Italiano o English. Il testo inviato non cambia.

type Lang = 'it' | 'en'
const LABEL: Record<Lang, string> = { it: 'Italiano', en: 'English' }

async function translate(text: string, lang: Lang): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch('/api/admin/inbox/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, lang }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Traduzione non riuscita')
  return data.translation
}

function useTranslation(text: string) {
  const [result, setResult] = useState<{ lang: Lang; text: string } | null>(null)
  const [loading, setLoading] = useState<Lang | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (lang: Lang) => {
    setLoading(lang)
    setError(null)
    try {
      setResult({ lang, text: await translate(text, lang) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Traduzione non riuscita')
    } finally {
      setLoading(null)
    }
  }
  return { result, setResult, loading, error, run }
}

function LangButtons({ run, loading, active, tone }: { run: (l: Lang) => void; loading: Lang | null; active?: Lang; tone: 'in' | 'out' }) {
  const base = tone === 'out' ? 'border-white/40 text-white' : 'border-[var(--border-color)] text-[var(--text-primary)]'
  return (
    <span className="inline-flex items-center gap-1.5">
      <Languages className={`w-3.5 h-3.5 ${tone === 'out' ? 'text-white/80' : 'text-[var(--text-secondary)]'}`} />
      {(Object.keys(LABEL) as Lang[]).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            run(lang)
          }}
          disabled={loading !== null}
          className={`px-2 py-0.5 rounded-full text-[11px] border disabled:opacity-50 ${base} ${active === lang ? 'font-semibold' : ''}`}
        >
          {loading === lang ? '…' : LABEL[lang]}
        </button>
      ))}
    </span>
  )
}

/** Testo di un messaggio: toccandolo compaiono i pulsanti di traduzione. */
export function TranslatableBody({ text, tone }: { text: string; tone: 'in' | 'out' }) {
  const [open, setOpen] = useState(false)
  const t = useTranslation(text)
  const muted = tone === 'out' ? 'text-white/75' : 'text-[var(--text-secondary)]'
  return (
    <div onClick={() => setOpen((v) => !v)} className="cursor-pointer" title="Tocca per tradurre">
      <p className="whitespace-pre-wrap break-words">{text}</p>
      {t.result && (
        <div className={`mt-2 pt-2 border-t ${tone === 'out' ? 'border-white/30' : 'border-[var(--border-color)]'}`}>
          <p className={`text-[10px] uppercase tracking-wide mb-0.5 ${muted}`}>Traduzione · {LABEL[t.result.lang]}</p>
          <p className="whitespace-pre-wrap break-words italic">{t.result.text}</p>
        </div>
      )}
      {(open || t.loading) && (
        <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <LangButtons run={t.run} loading={t.loading} active={t.result?.lang} tone={tone} />
          {t.result && (
            <button type="button" onClick={() => t.setResult(null)} className={`text-[11px] underline ${muted}`}>
              Solo originale
            </button>
          )}
        </div>
      )}
      {t.error && <p className="mt-1 text-[11px] text-[#FF3B30]">{t.error}</p>}
    </div>
  )
}

/** Sotto una bozza da approvare: per capire cosa sta per partire (es. una risposta in russo). */
export function DraftTranslate({ text }: { text: string }) {
  const t = useTranslation(text)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-secondary)]">Traduci la bozza:</span>
        <LangButtons run={t.run} loading={t.loading} active={t.result?.lang} tone="in" />
      </div>
      {t.result && (
        <p className="whitespace-pre-wrap break-words italic text-[12px] text-[var(--text-secondary)] border-l-2 border-[var(--border-color)] pl-2">
          {t.result.text}
        </p>
      )}
      {t.error && <p className="text-[11px] text-[#FF3B30]">{t.error}</p>}
    </div>
  )
}
