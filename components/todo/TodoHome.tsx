'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { formatRome, projectColor, romeDay, type TodoCalendarTask, type TodoHomeData } from '@/lib/todo-shared'

// Schermata generale dei progetti, uguale per l'admin e per le persone: le cartelle
// dei progetti (nome del cliente, conteggi, prossima scadenza) e un calendario grande
// del mese con le attivita' che hanno una scadenza, colorate per progetto. Toccando
// un'attivita' si apre nel suo progetto. Sul telefono il calendario diventa un elenco
// per giorno. Ora italiana.

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const MAX_CHIPS = 3

const monthLabel = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 15)).toLocaleString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
const two = (n: number) => String(n).padStart(2, '0')

export type HomeProps = {
  data: TodoHomeData
  onOpen: (boardId: string, taskId?: string) => void
  /** Selezione delle cartelle (solo l'admin). */
  selected?: Set<string>
  onToggleSelect?: (boardId: string) => void
  /** Riga in piu' sotto la cartella (es. chi la vede). */
  folderExtra?: (boardId: string) => ReactNode
  emptyText?: string
  /** Pulsante accanto al calendario (es. «Aggiungi all'iPhone»). */
  calendarAction?: ReactNode
}

export default function TodoHome({ data, onOpen, selected, onToggleSelect, folderExtra, emptyText = 'Ancora nessun progetto.', calendarAction }: HomeProps) {
  const today = romeDay(Date.now())
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }))
  const [filter, setFilter] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)

  const colors = useMemo(() => new Map(data.boards.map((b, i) => [b.id, projectColor(i)])), [data.boards])
  const names = useMemo(() => new Map(data.boards.map((b) => [b.id, b.name])), [data.boards])

  const byDay = useMemo(() => {
    const map = new Map<string, TodoCalendarTask[]>()
    for (const t of data.tasks) {
      if (filter && t.board_id !== filter) continue
      if (!names.has(t.board_id)) continue
      const d = romeDay(Date.parse(t.deadline))
      const list = map.get(d) || []
      list.push(t)
      map.set(d, list)
    }
    return map
  }, [data.tasks, filter, names])

  const prefix = `${ym.y}-${two(ym.m)}-`
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()
  const firstWeekday = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${prefix}${two(i + 1)}`)]
  while (cells.length % 7) cells.push(null)
  const monthDays = [...byDay.keys()].filter((d) => d.startsWith(prefix)).sort()
  const now = Date.now()

  const shift = (delta: number) => {
    setOpenDay(null)
    setYm(({ y, m }) => {
      const t = y * 12 + (m - 1) + delta
      return { y: Math.floor(t / 12), m: (t % 12) + 1 }
    })
  }

  const chip = (t: TodoCalendarTask, withProject = false) => {
    const late = !t.done && Date.parse(t.deadline) < now
    const color = colors.get(t.board_id) || '#007AFF'
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onOpen(t.board_id, t.id)}
        title={`${names.get(t.board_id) || ''} · ${t.title} · ${formatRome(t.deadline)}`}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight hover:brightness-95 ${late ? 'ring-1 ring-[#FF3B30]/60' : ''}`}
        style={{ background: `${color}22`, color: 'var(--text-primary)' }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className={`min-w-0 flex-1 truncate ${t.done ? 'line-through opacity-60' : ''}`}>
          {withProject && <span className="font-semibold">{names.get(t.board_id)} · </span>}
          {t.title}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">{timeOf(t.deadline)}</span>
      </button>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cartelle dei progetti */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Progetti</h2>
        {data.boards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-color)] p-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.boards.map((b) => {
              const color = colors.get(b.id) as string
              const isSel = selected?.has(b.id)
              return (
                <div key={b.id} className={`relative rounded-2xl border bg-[var(--background-secondary)] transition ${isSel ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/40' : 'border-[var(--border-color)] hover:border-[var(--accent-blue)]/60'}`}>
                  <button type="button" onClick={() => onOpen(b.id)} className="block w-full p-3 text-left">
                    <span className={`flex items-start gap-2 ${onToggleSelect ? 'pr-8' : ''}`}>
                      <Folder className="mt-0.5 h-6 w-6 shrink-0" style={{ color, fill: `${color}33` }} />
                      <span className="min-w-0 break-words text-sm font-semibold leading-snug text-[var(--text-primary)]">{b.name}</span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1 text-[11px]">
                      <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[var(--text-primary)]">{b.todo} da fare</span>
                      {b.late > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#FF3B30]/15 px-2 py-0.5 font-semibold text-[#FF3B30]">
                          <AlertTriangle className="h-3 w-3" /> {b.late} in ritardo
                        </span>
                      )}
                      <span className="rounded-full bg-[#34C759]/15 px-2 py-0.5 text-[#34C759]">{b.done} fatte</span>
                    </span>
                    <span className="mt-1.5 block truncate text-[11px] text-[var(--text-secondary)]">{b.next ? `Prossima: ${formatRome(b.next)}` : 'Nessuna scadenza in arrivo'}</span>
                    {folderExtra?.(b.id)}
                  </button>
                  {onToggleSelect && (
                    <button
                      type="button"
                      onClick={() => onToggleSelect(b.id)}
                      className={`absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border-2 ${isSel ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] bg-[var(--background)] text-transparent'}`}
                      aria-label={isSel ? `Togli «${b.name}» dalla selezione` : `Seleziona «${b.name}»`}
                      aria-pressed={isSel}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Calendario */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold capitalize text-[var(--text-primary)]">
            <CalendarDays className="h-5 w-5 text-[var(--accent-blue)]" /> {monthLabel(ym.y, ym.m)}
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            {calendarAction}
            <button type="button" onClick={() => shift(-1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-primary)]" aria-label="Mese prima">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenDay(null)
                setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })
              }}
              className="inline-flex min-h-[36px] items-center rounded-full border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-primary)]"
            >
              Oggi
            </button>
            <button type="button" onClick={() => shift(1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-primary)]" aria-label="Mese dopo">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {data.boards.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <button type="button" onClick={() => setFilter(null)} className={`inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border px-3 text-xs ${!filter ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-primary)]'}`}>
              Tutti i progetti
            </button>
            {data.boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setFilter(filter === b.id ? null : b.id)}
                className={`inline-flex min-h-[32px] max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs ${filter === b.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 font-semibold text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-primary)]'}`}
              >
                {filter === b.id ? <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: colors.get(b.id) }} /> : <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: colors.get(b.id) }} />}
                <span className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Mese (computer e tablet) */}
        <div className="mt-3 hidden md:block">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase text-[var(--text-secondary)]">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="min-h-[104px] rounded-lg bg-[var(--background)]/40" />
              const tasks = byDay.get(d) || []
              const expanded = openDay === d
              const shown = expanded ? tasks : tasks.slice(0, MAX_CHIPS)
              return (
                <div key={d} className={`min-h-[104px] min-w-0 rounded-lg border bg-[var(--background)] p-1 ${d === today ? 'border-[var(--accent-blue)]' : 'border-transparent'}`}>
                  <div className={`mb-1 text-right text-xs ${d === today ? 'font-bold text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}>{Number(d.slice(8))}</div>
                  <div className="flex flex-col gap-0.5">
                    {shown.map((t) => chip(t))}
                    {tasks.length > MAX_CHIPS && (
                      <button type="button" onClick={() => setOpenDay(expanded ? null : d)} className="rounded px-1 text-left text-[11px] font-semibold text-[var(--accent-blue)]">
                        {expanded ? 'Meno' : `+${tasks.length - MAX_CHIPS} altre`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Elenco per giorno (telefono) */}
        <div className="mt-3 space-y-3 md:hidden">
          {monthDays.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">Nessuna scadenza in questo mese.</p>
          ) : (
            monthDays.map((d) => (
              <div key={d}>
                <p className={`mb-1 text-xs font-semibold capitalize ${d === today ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}>
                  {dayLabel(d)}
                  {d === today ? ' · oggi' : ''}
                </p>
                <div className="flex flex-col gap-1">{(byDay.get(d) || []).map((t) => chip(t, true))}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
