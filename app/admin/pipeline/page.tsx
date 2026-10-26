'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { Check, Mail, Phone } from 'lucide-react'
import Navigation from '@/components/Navigation'
import { getAccessToken } from '@/lib/session-token'
import AutopilotPanel from './AutopilotPanel'
import OutreachReplyPanel from './OutreachReplyPanel'
import AppointmentsPanel from './AppointmentsPanel'
import LiveFeed, { type FeedEvent } from './LiveFeed'

// Motore clienti: la pipeline vera in una schermata. Le schede passano da sole
// da una colonna all'altra man mano che avanzano (ricerca, analisi, contatto,
// risposta, cliente), anche mentre la super chat lavora.

type StageId = 'found' | 'research' | 'outreach' | 'replies' | 'clients'
type Card = { id: string; name: string; place: string | null; at: string; via?: 'email' | 'phone'; email: boolean }
type Data = {
  period: string
  stages: { id: StageId; reached: number; recent: number | null }[]
  cards: Record<StageId, Card[]>
  hero: { replies: number; contacted: number; clients: number; replyRate: number }
  discarded: number
  events: FeedEvent[]
  running: { text: string } | null
}

const STAGE_LABEL: Record<StageId, string> = {
  found: 'Trovati',
  research: 'Analizzati',
  outreach: 'Contattati',
  replies: 'Risposte',
  clients: 'Clienti',
}
const PERIODS = [
  { id: '7', label: '7 giorni', text: 'negli ultimi 7 giorni' },
  { id: '30', label: '30 giorni', text: 'negli ultimi 30 giorni' },
  { id: 'all', label: 'Sempre', text: 'in totale' },
]
const ACCENT = '#0A84FF'
const DONE = '#34C759'
const REFRESH_MS = 6000

async function authFetch(url: string) {
  const token = await getAccessToken()
  return fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
}

/** Numero che sale (o scende) fino al valore nuovo invece di cambiare di colpo. */
function useCounter(value: number) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = Math.round(begin + (value - begin) * eased)
      setShown(current)
      from.current = current
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return shown
}

function Counter({ value }: { value: number }) {
  return <>{useCounter(value).toLocaleString('it-IT')}</>
}

/** Cerchio di avanzamento: vuoto e tratteggiato all'inizio, pieno con la spunta all'ultima fase. */
function StageIcon({ index }: { index: number }) {
  if (index === 4) {
    return (
      <span className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: DONE }}>
        <Check className="w-3 h-3 text-white" strokeWidth={3} />
      </span>
    )
  }
  const r = 6
  const c = 2 * Math.PI * r
  const color = index === 0 ? 'var(--text-secondary)' : ACCENT
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={index === 0 ? '2 2' : undefined} opacity={index === 0 ? 0.8 : 0.35} />
      {index > 0 && (
        <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={`${(c * index) / 4} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />
      )}
    </svg>
  )
}

function shortDate(iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return `oggi ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
  if (days === 1) return 'ieri'
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function LeadCard({ card, stage, flash, delay }: { card: Card; stage: StageId; flash: boolean; delay: number }) {
  const won = stage === 'clients'
  const glow = won ? DONE : ACCENT
  return (
    <motion.div
      layout
      layoutId={card.id}
      initial={{ opacity: 0, y: 14, scale: 0.92 }}
      animate={{
        opacity: 1,
        y: 0,
        // Qualcosa e' appena successo a questo contatto: la scheda pulsa e si illumina.
        scale: flash ? [1, 1.06, 1] : 1,
        boxShadow: flash ? [`0 0 0 0 ${glow}00`, `0 0 0 4px ${glow}66`, `0 0 0 0 ${glow}00`] : `0 0 0 0 ${glow}00`,
      }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, delay, ...(flash ? { duration: 1.4, type: 'tween' } : {}) }}
      className="rounded-xl border bg-[var(--background-secondary)] px-2.5 py-2 min-w-0"
      style={{ borderColor: won ? DONE : 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[10px] tabular-nums truncate" style={{ color: won ? DONE : 'var(--text-secondary)' }}>
          {won && <Check className="w-3 h-3 shrink-0" strokeWidth={3} />}
          {card.via === 'email' && <Mail className="w-3 h-3 shrink-0" />}
          {card.via === 'phone' && <Phone className="w-3 h-3 shrink-0" />}
          {won ? 'Cliente' : shortDate(card.at)}
        </span>
        <span
          className="w-4 h-4 shrink-0 rounded-full text-[9px] font-semibold flex items-center justify-center"
          style={{ background: `${won ? DONE : ACCENT}22`, color: won ? DONE : ACCENT }}
        >
          {card.name.trim().charAt(0).toUpperCase()}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] font-semibold text-[var(--text-primary)] truncate" title={card.name}>
        {card.name}
      </p>
      <p className="text-[11px] text-[var(--text-secondary)] truncate">{card.place || (card.email ? 'email trovata' : '—')}</p>
    </motion.div>
  )
}

export default function PipelinePage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [period, setPeriod] = useState('7')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Cosa sta facendo l'automazione giornaliera (ha la precedenza sulla super chat).
  const [autopilotText, setAutopilotText] = useState<string | null>(null)
  // Eventi gia' visti: quelli nuovi entrano evidenziati e fanno pulsare la scheda del contatto.
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const firstLoad = useRef(true)

  const load = useCallback(async (p: string) => {
    const res = await authFetch(`/api/admin/pipeline?period=${p}`).catch(() => null)
    if (!res) return
    if (res.status === 401 || res.status === 403) return setAuthorized(false)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error || 'Errore nel caricare i dati')
    setAuthorized(true)
    setError(null)
    const events: FeedEvent[] = json.events || []
    if (seen.current) {
      const added = events.filter((e) => !seen.current!.has(e.id))
      if (added.length) {
        setFresh(new Set(added.map((e) => e.id)))
        setFlash(new Set(added.map((e) => e.leadId).filter((id): id is string => Boolean(id))))
        setTimeout(() => setFlash(new Set()), 2500)
      }
    }
    seen.current = new Set([...(seen.current || []), ...events.map((e) => e.id)])
    setData(json)
    // Dopo il primo disegno le schede non aspettano piu' il turno di entrata.
    setTimeout(() => (firstLoad.current = false), 1500)
  }, [])

  useEffect(() => {
    load(period)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(period)
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, period])

  if (authorized === false) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <p className="pt-32 text-center text-[var(--text-secondary)]">Non hai accesso a questa pagina: chiedilo all’amministratore.</p>
      </main>
    )
  }

  const periodText = PERIODS.find((p) => p.id === period)?.text || ''
  const activity = autopilotText || data?.running?.text || null

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 pt-20 md:pt-24 pb-28 md:pb-10">
        {/* Testata */}
        <div className="flex items-center justify-between gap-3">
          <p className="shrink-0 whitespace-nowrap text-sm text-[var(--text-secondary)]">
            <Link href="/admin/leads" className="hover:text-[var(--text-primary)]">
              Clienti
            </Link>{' '}
            / <span className="text-[var(--text-primary)] font-medium">Motore clienti</span>
          </p>
          <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)] min-w-0">
            <span className="relative flex w-2 h-2 shrink-0">
              {activity && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: DONE, opacity: 0.6 }} />}
              <span className="relative w-2 h-2 rounded-full" style={{ background: activity ? DONE : 'var(--text-secondary)' }} />
            </span>
            <span className="truncate max-w-[40vw] md:max-w-sm">{activity || 'In pausa'}</span>
          </span>
        </div>

        {/* Numero principale */}
        <section className="mt-6 pb-6 border-b border-[var(--border-color)] flex items-center gap-5 md:gap-8">
          <span className="text-[72px] md:text-[120px] leading-none font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
            <Counter value={data?.hero.replies ?? 0} />
          </span>
          <div className="min-w-0">
            <p className="text-xl md:text-3xl font-semibold text-[var(--text-primary)]">
              {data?.hero.replies === 1 ? 'risposta' : 'risposte'}
            </p>
            <p className="text-base md:text-xl text-[var(--text-secondary)]">{periodText}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
              <span>
                <b className="text-[var(--text-primary)] tabular-nums">
                  <Counter value={data?.hero.contacted ?? 0} />
                </b>{' '}
                contattati
              </span>
              <span>
                <b className="text-[var(--text-primary)] tabular-nums">
                  <Counter value={data?.hero.clients ?? 0} />
                </b>{' '}
                clienti
              </span>
              <span>
                <b className="text-[var(--text-primary)] tabular-nums">{data?.hero.replyRate ?? 0}%</b> risponde
              </span>
            </p>
          </div>
        </section>

        <div className="mt-4 flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
                period === p.id ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-[#FF3B30]">{error}</p>}
        {!data && !error && <p className="mt-6 text-sm text-[var(--text-secondary)]">Caricamento…</p>}

        {/* Colonne: sul telefono scorrono di lato */}
        {data && (
          <LayoutGroup>
            <div className="mt-5 -mx-4 px-4 overflow-x-auto overscroll-x-contain md:overflow-visible md:mx-0 md:px-0">
              <div className="grid grid-cols-[repeat(5,minmax(128px,1fr))] gap-2 md:gap-3 min-w-[680px] md:min-w-0">
                {data.stages.map((stage, index) => (
                  <div key={stage.id} className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <StageIcon index={index} />
                      <span className="text-sm font-semibold" style={{ color: index === 4 ? DONE : 'var(--text-primary)' }}>
                        {STAGE_LABEL[stage.id]}
                      </span>
                    </div>
                    <p className="mt-0.5 mb-2 pl-[22px] text-xs tabular-nums text-[var(--text-secondary)]">
                      <Counter value={stage.reached} />
                      {stage.recent ? <span style={{ color: ACCENT }}> +{stage.recent}</span> : null}
                    </p>
                    <div className="space-y-2">
                      <AnimatePresence mode="popLayout">
                        {data.cards[stage.id].map((card, row) => (
                          <LeadCard
                            key={card.id}
                            card={card}
                            stage={stage.id}
                            flash={flash.has(card.id)}
                            delay={firstLoad.current ? index * 0.12 + row * 0.07 : 0}
                          />
                        ))}
                      </AnimatePresence>
                      {data.cards[stage.id].length === 0 && (
                        <div className="h-[62px] rounded-xl border border-dashed border-[var(--border-color)]" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </LayoutGroup>
        )}

        {data && (
          <p className="mt-6 text-xs text-[var(--text-secondary)]">
            Ogni colonna mostra le schede arrivate più di recente in quella fase; il numero sotto il nome conta tutte quelle che
            l’hanno raggiunta{data.period !== 'all' ? ` (in blu quelle ${periodText})` : ''}.
            {data.discarded ? ` ${data.discarded} scartate non sono nelle colonne.` : ''} Si aggiorna da sola.
          </p>
        )}

        {data && <LiveFeed events={data.events || []} fresh={fresh} />}
        {authorized && <AppointmentsPanel />}
        {authorized && <AutopilotPanel onRunning={setAutopilotText} />}
        {authorized && <OutreachReplyPanel />}
      </div>
    </main>
  )
}
