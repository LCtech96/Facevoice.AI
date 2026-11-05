'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ImagePlus, Loader2, MessageCircleReply, Save } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'
import { useStaffAccess } from '@/components/useStaffAccess'
import { prepareImage } from '@/lib/client-image'

// Interruttore delle risposte automatiche a chi abbiamo contattato noi per primi,
// separato da quello della casella Messaggi, con gli esempi di strategia di Luca.

type Settings = { auto: boolean; strategy: string }
const DONE = '#34C759'
const ACCENT = '#0A84FF'

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

export default function OutreachReplyPanel() {
  const staff = useStaffAccess()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [open, setOpen] = useState(false)
  const [strategy, setStrategy] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Screenshot di conversazioni vere: l'AI le legge e ne ricava il metodo, che si aggiunge agli esempi.
  const [reading, setReading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const readScreenshots = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/')).slice(0, 12)
    if (!list.length) return
    setNotice(null)
    const added: string[] = []
    let failed = ''
    try {
      // A gruppi di 3: gli screenshot della stessa conversazione vengono letti insieme.
      for (let i = 0; i < list.length; i += 3) {
        const group = list.slice(i, i + 3)
        setReading(list.length > 3 ? `Leggo gli screenshot ${i + 1}-${i + group.length} di ${list.length}…` : 'Leggo gli screenshot…')
        const images = await Promise.all(group.map((f) => prepareImage(f).then((img) => img.data)))
        const res = await authFetch('/api/admin/outreach-reply/screenshots', { method: 'POST', body: JSON.stringify({ images }) }).catch(() => null)
        const data = res ? await res.json().catch(() => ({})) : {}
        if (!res?.ok || !data.example) {
          failed = data.error || 'Lettura non riuscita, riprova.'
          break
        }
        added.push(data.example)
      }
    } catch {
      failed = 'Uno dei file non è un’immagine valida.'
    } finally {
      setReading(null)
    }
    if (added.length) {
      const day = new Date().toLocaleDateString('it-IT')
      setStrategy((current) => [current.trim(), ...added.map((text) => `--- Da screenshot (${day}) ---\n${text}`)].filter(Boolean).join('\n\n'))
    }
    setNotice(
      failed
        ? `${added.length ? 'Una parte è stata aggiunta. ' : ''}${failed}`
        : 'Letti: conversazione e metodo sono stati aggiunti qui sotto. Controlla e premi “Salva esempi”.'
    )
  }

  useEffect(() => {
    authFetch('/api/admin/outreach-reply')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setSettings(data.settings))
      .catch(() => undefined)
  }, [])

  const save = async (patch: Partial<Settings>) => {
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/outreach-reply', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice(data.error || 'Non salvato, riprova.')
    setSettings(data.settings)
    if (patch.strategy !== undefined) {
      setOpen(false)
      setNotice('Esempi salvati: le prossime controrisposte seguiranno questo metodo.')
    }
  }

  if (!settings) return null
  const canEdit = staff.isAdmin

  return (
    <section className="mt-3 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <MessageCircleReply className="w-4 h-4 shrink-0" style={{ color: settings.auto ? DONE : 'var(--text-secondary)' }} />
            Risposte automatiche ai contatti
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: `${settings.auto ? DONE : '#8E8E93'}22`, color: settings.auto ? DONE : 'var(--text-secondary)' }}
            >
              {settings.auto ? 'attive' : 'da approvare'}
            </span>
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {settings.auto
              ? 'Chi risponde alle email che mandiamo noi riceve sempre una controrisposta: parte da sola dopo 4-12 minuti, e fino ad allora la trovi in Messaggi per cambiarla o fermarla. Prezzi, reclami, questioni legali e chi chiede di non essere ricontattato restano da approvare.'
              : 'Le controrisposte a chi risponde alle nostre email vengono preparate in Messaggi e partono solo quando le approvi. Separato dall’interruttore di Messaggi.'}
          </p>
        </div>
        {canEdit && (
          <button
            role="switch"
            aria-checked={settings.auto}
            aria-label="Risposte automatiche ai contatti"
            disabled={busy}
            onClick={() => save({ auto: !settings.auto })}
            className="relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40"
            style={{ background: settings.auto ? DONE : 'var(--border-color)' }}
          >
            <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all" style={{ left: settings.auto ? 22 : 2 }} />
          </button>
        )}
      </div>

      {canEdit && (
        <button
          onClick={() => {
            setStrategy(settings.strategy)
            setOpen(!open)
          }}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-primary)]"
        >
          Esempi di strategia {settings.strategy ? '(salvati)' : ''}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Il metodo della tua conversazione con Dario è già incluso. Qui puoi incollare altre conversazioni vere scritte da te: l’AI ne prende il metodo, cioè come rispondi, come
            sposti il discorso e come porti alla chiamata, ma scrive sempre come Luca di Facevoice AI e non copia frasi o persone.
          </p>
          <div className="rounded-lg border border-dashed border-[var(--border-color)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">
              Oppure carica degli screenshot di email o chat già avute (il messaggio ricevuto e la tua risposta): l’AI li legge, trascrive la
              conversazione senza nomi e ricava come rispondi a ogni tipo di messaggio.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                readScreenshots(files)
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={Boolean(reading) || busy}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-50"
            >
              {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {reading || 'Aggiungi screenshot'}
            </button>
          </div>
          <textarea
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            rows={10}
            placeholder={'Lui: …\nIo: …\nLui: …\nIo: …'}
            className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[16px] sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent-blue)]"
          />
          <button
            onClick={() => save({ strategy })}
            disabled={busy || Boolean(reading)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-white disabled:opacity-40"
            style={{ background: ACCENT }}
          >
            <Save className="w-4 h-4" /> Salva esempi
          </button>
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-[var(--text-secondary)]">{notice}</p>}
    </section>
  )
}
