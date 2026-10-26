'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, CalendarPlus, Copy, Phone, X } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Appuntamenti fissati dall'AI nelle conversazioni, con il collegamento al
// calendario dell'iPhone (abbonamento: si aggiornano da soli, con promemoria).

type Appointment = {
  id: string
  when: string
  kind: string
  phone: string | null
  note: string | null
  contactName: string | null
  platform: string
}

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export default function AppointmentsPanel() {
  const [list, setList] = useState<Appointment[] | null>(null)
  const [calendar, setCalendar] = useState<{ webcal: string; https: string } | null>(null)
  const [help, setHelp] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/appointments').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setList(data.appointments || [])
    setCalendar(data.calendarUrl ? { webcal: data.calendarUrl, https: data.calendarHttps } : null)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 15_000)
    return () => clearInterval(timer)
  }, [load])

  const cancel = async (a: Appointment) => {
    if (!window.confirm(`Annullare l’appuntamento con ${a.contactName || 'questo contatto'}? Sparisce anche dal calendario.`)) return
    const res = await authFetch('/api/admin/appointments', { method: 'PATCH', body: JSON.stringify({ id: a.id, status: 'cancelled' }) }).catch(() => null)
    if (!res?.ok) return setNotice('Non sono riuscito ad annullarlo, riprova.')
    load()
  }

  const copy = async () => {
    if (!calendar) return
    await navigator.clipboard?.writeText(calendar.https).catch(() => undefined)
    setNotice('Indirizzo copiato.')
  }

  if (!list) return null

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          <CalendarCheck className="w-4 h-4 text-[#34C759]" /> Appuntamenti fissati
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#34C759]/15 text-[#34C759]">{list.length}</span>
        </p>
        {calendar && (
          <div className="flex gap-2">
            <a
              href={calendar.webcal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white bg-[#34C759]"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> Aggiungi al calendario dell’iPhone
            </a>
            <button onClick={() => setHelp(!help)} className="px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-secondary)]">
              Come funziona
            </button>
          </div>
        )}
      </div>

      {help && calendar && (
        <div className="mt-3 rounded-xl bg-[var(--background)] border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)] space-y-1.5">
          <p>
            Dall’iPhone tocca <b>“Aggiungi al calendario dell’iPhone”</b> e conferma <b>Abbonati</b>: nasce il calendario “Facevoice ·
            Appuntamenti”. Ogni appuntamento fissato dall’AI compare lì da solo, con un promemoria 30 e 10 minuti prima.
          </p>
          <p>
            Se il tocco non apre niente: Impostazioni › Calendario › Account › Aggiungi account › Altro › Aggiungi calendario abbonato,
            e incolla l’indirizzo.{' '}
            <button onClick={copy} className="inline-flex items-center gap-1 underline">
              <Copy className="w-3 h-3" /> Copia indirizzo
            </button>
          </p>
          <p>
            Perché si aggiorni in fretta: Impostazioni › Calendario › Account › Scarica nuovi dati › “Ogni 15 minuti”. In più, appena un
            appuntamento viene fissato, ti arriva subito una notifica.
          </p>
          <p>L’indirizzo è segreto: non condividerlo.</p>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {list.length === 0 && (
          <p className="text-sm text-[var(--text-secondary)]">
            Nessuno per ora. Quando una persona conferma giorno e ora di una chiamata in chat o via email, l’appuntamento compare qui.
          </p>
        )}
        {list.map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-xl bg-[var(--background)] border border-[var(--border-color)] p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] capitalize">{when(a.when)}</p>
              <p className="text-sm text-[var(--text-primary)]">
                {a.kind} con <b>{a.contactName || 'contatto'}</b> <span className="text-[var(--text-secondary)]">· {a.platform}</span>
              </p>
              {a.phone && (
                <a href={`tel:${a.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)]">
                  <Phone className="w-3 h-3" /> {a.phone}
                </a>
              )}
              {a.note && <p className="text-xs text-[var(--text-secondary)]">{a.note}</p>}
            </div>
            <button onClick={() => cancel(a)} aria-label="Annulla appuntamento" className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#FF3B30]">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      {notice && <p className="mt-2 text-xs text-[var(--text-secondary)]">{notice}</p>}
    </section>
  )
}
