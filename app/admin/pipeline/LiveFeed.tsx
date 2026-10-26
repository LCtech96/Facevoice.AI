'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CalendarCheck, Globe, MessageCircle, Reply, Search, Send } from 'lucide-react'

// Flusso "in tempo reale" del Motore clienti: gli ultimi eventi (ricerche, siti
// letti, email, messaggi, risposte, appuntamenti) che entrano animati in cima.

export type FeedEvent = { id: string; at: string; kind: string; text: string; leadId?: string; platform?: string }

const KIND: Record<string, { icon: typeof Search; color: string }> = {
  found: { icon: Search, color: '#8E8E93' },
  research: { icon: Globe, color: '#0A84FF' },
  outreach: { icon: Send, color: '#0A84FF' },
  replies: { icon: MessageCircle, color: '#FF9500' },
  answer: { icon: Reply, color: '#AF52DE' },
  meeting: { icon: CalendarCheck, color: '#34C759' },
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export default function LiveFeed({ events, fresh }: { events: FeedEvent[]; fresh: Set<string> }) {
  return (
    <section className="mt-6">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <span className="relative flex w-2 h-2">
          <span className="absolute inset-0 rounded-full animate-ping bg-[#34C759] opacity-60" />
          <span className="relative w-2 h-2 rounded-full bg-[#34C759]" />
        </span>
        In tempo reale
      </p>
      <div className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] overflow-hidden">
        {events.length === 0 && <p className="p-4 text-sm text-[var(--text-secondary)]">Ancora niente negli ultimi giorni.</p>}
        <ul className="max-h-[360px] overflow-y-auto">
          <AnimatePresence initial={true}>
            {events.map((e, i) => {
              const k = KIND[e.kind] || KIND.found
              const Icon = k.icon
              const isNew = fresh.has(e.id)
              return (
                <motion.li
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -14, backgroundColor: `${k.color}33` }}
                  animate={{ opacity: 1, y: 0, backgroundColor: isNew ? [`${k.color}40`, `${k.color}00`] : `${k.color}00` }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: isNew ? 2.2 : 0.35, delay: isNew ? 0 : Math.min(i, 10) * 0.05 }}
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--border-color)] last:border-b-0"
                >
                  <span className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center" style={{ background: `${k.color}22`, color: k.color }}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{e.text}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">{ago(e.at)}</span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      </div>
    </section>
  )
}
