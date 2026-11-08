'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownWideNarrow, Bell, CalendarClock, ChevronLeft, ChevronRight, GripVertical, ImageIcon, Link2, Loader2, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, User, PenLine } from 'lucide-react'
import { PRIORITIES, formatRome, taskVisibleTo, type TodoBoardState, type TodoList, type TodoTask } from '@/lib/todo-shared'
import { boardOp, loadBoard, moveLocally, patchLocally, tasksOf } from './todo-api'
import TaskModal from './TaskModal'
import LinkText from './LinkText'

// Bacheca della todo list: tabelle (colonne) con le attivita'. Uguale per l'admin
// e per chi ha il link, ma ognuno riceve dal server solo quello che puo' vedere e i
// permessi (can_edit, can_add...): qui si nascondono solo i comandi, il server ricontrolla. Si aggiorna da sola ogni pochi secondi; ogni modifica manda
// solo il campo cambiato (l'ultima modifica di un campo vince) e gli spostamenti
// usano posizioni, cosi' due persone insieme non perdono attivita'.
// Spostare: trascina la maniglia (anche con il dito) oppure usa "Sposta" nella scheda.

const POLL_MS = 6000

type Drop = { listId: string; index: number }

/** Dove si puo' lasciare un'attivita': stessa tabella, o una tabella dove si puo' aggiungere (le tabelle di una persona solo per le sue). */
export function canDropIn(list: TodoList, task: TodoTask): boolean {
  if (list.id === task.list_id) return true
  if (!list.can_add) return false
  return list.created_by_member === null || task.can_edit
}

function deadlineTone(task: TodoTask, now: number) {
  if (!task.deadline || task.done) return 'border border-[var(--border-color)] text-[var(--text-secondary)]'
  const left = Date.parse(task.deadline) - now
  if (left < 0) return 'bg-[#FF3B30]/15 text-[#FF3B30]'
  if (left < 24 * 3600_000) return 'bg-[#FF9500]/15 text-[#FF9500]'
  return 'border border-[var(--border-color)] text-[var(--text-secondary)]'
}

export default function TodoBoard({ token, onLocked }: { token: string; onLocked: () => void }) {
  const [state, setState] = useState<TodoBoardState | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [newList, setNewList] = useState('')
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [editingList, setEditingList] = useState<string | null>(null)
  const [listMenu, setListMenu] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [drag, setDrag] = useState<{ taskId: string; drop: Drop | null } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [person, setPerson] = useState('')

  const pending = useRef(0)
  const dragRef = useRef<{ taskId: string; drop: Drop | null; x: number; y: number; x0: number; y0: number; dx: number; dy: number; w: number; moved: boolean } | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const loadSeq = useRef(0)
  const stateRef = useRef<TodoBoardState | null>(null)
  stateRef.current = state

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current
    setSyncing(true)
    const r = await loadBoard(token)
    setSyncing(false)
    // Risposta vecchia (nel frattempo e' partita un'altra lettura o una modifica): si scarta.
    if (seq !== loadSeq.current || pending.current > 0 || dragRef.current) return
    if (r.ok) {
      setState(r.state)
      setFatal(null)
      setNow(Date.now())
      return
    }
    if (r.needPassword) return onLocked()
    if (r.status === 404) setFatal('Il link non è più valido. Chiedi un link nuovo a chi te l’ha mandato.')
    else if (r.status === 503 && /SQL/.test(r.error)) setFatal(r.error)
    else setMessage(r.error)
  }, [token, onLocked])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, POLL_MS)
    const onVisible = () => !document.hidden && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(t)
  }, [message])

  /** Modifica: subito sulla pagina, poi al server, poi si rilegge tutto. */
  const run = useCallback(
    async (body: Record<string, unknown>, local?: (s: TodoBoardState) => TodoBoardState) => {
      if (local) setState((s) => (s ? local(s) : s))
      pending.current++
      loadSeq.current++
      const r = await boardOp(token, body)
      pending.current--
      if (!r.ok) {
        if (r.needPassword) {
          onLocked()
          return r
        }
        setMessage(r.error)
      }
      if (pending.current === 0) refresh()
      return r
    },
    [token, onLocked, refresh]
  )

  // ------------------------------------------------------------------
  // Trascinamento con la maniglia (mouse e dito)
  // ------------------------------------------------------------------

  const findDrop = useCallback((x: number, y: number, taskId: string): Drop | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const col = el?.closest('[data-list-id]') as HTMLElement | null
    if (!col) return null
    const listId = col.dataset.listId as string
    const s = stateRef.current
    const list = s?.lists.find((l) => l.id === listId)
    const task = s?.tasks.find((t) => t.id === taskId)
    if (!list || !task || !canDropIn(list, task)) return null
    const cards = Array.from(col.querySelectorAll<HTMLElement>('[data-task-id]')).filter((c) => c.dataset.taskId !== taskId)
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) {
        index = i
        break
      }
    }
    return { listId, index }
  }, [])

  useEffect(() => {
    if (!drag) return
    let frame = 0
    // Scorrimento automatico vicino ai bordi mentre si trascina.
    const tick = () => {
      const d = dragRef.current
      const box = scrollerRef.current
      // Solo dopo che il dito (o il mouse) si e' mosso davvero.
      if (d && box && d.moved) {
        const r = box.getBoundingClientRect()
        if (d.x < r.left + 48) box.scrollLeft -= 14
        else if (d.x > r.right - 48) box.scrollLeft += 14
        if (d.y < 70) window.scrollBy(0, -12)
        else if (d.y > window.innerHeight - 70) window.scrollBy(0, 12)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      d.x = e.clientX
      d.y = e.clientY
      if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) > 10) d.moved = true
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${e.clientX - d.dx}px, ${e.clientY - d.dy}px)`
      const drop = findDrop(e.clientX, e.clientY, d.taskId)
      if (drop && (drop.listId !== d.drop?.listId || drop.index !== d.drop?.index)) {
        d.drop = drop
        setDrag({ taskId: d.taskId, drop })
      }
    }
    const end = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d || e.type === 'pointercancel' || !d.drop) return
      const target = d.drop
      const s = stateRef.current
      const task = s?.tasks.find((t) => t.id === d.taskId)
      if (!s || !task) return
      // Rilasciata dove era: niente da fare.
      const oldIndex = tasksOf(s, task.list_id).findIndex((t) => t.id === task.id)
      if (task.list_id === target.listId && oldIndex === target.index) return
      void run({ op: 'moveTask', taskId: task.id, listId: target.listId, index: target.index }, (st) => moveLocally(st, task.id, target.listId, target.index))
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    // Il trascinamento parte e finisce: gli ascoltatori si legano una volta per trascinamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag), findDrop, run])

  const startDrag = (e: React.PointerEvent, task: TodoTask) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (!task.can_move) return
    // Con il filtro «Persona» le posizioni sullo schermo non sono tutte: si sposta dalla scheda.
    if (person) return
    e.preventDefault()
    e.stopPropagation()
    const card = (e.currentTarget as HTMLElement).closest('[data-task-id]') as HTMLElement | null
    const r = card?.getBoundingClientRect()
    // All'inizio il punto di arrivo e' dove l'attivita' si trova gia'.
    const startIndex = state ? tasksOf(state, task.list_id).findIndex((t) => t.id === task.id) : 0
    const drop = { listId: task.list_id, index: Math.max(0, startIndex) }
    dragRef.current = { taskId: task.id, drop, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, dx: r ? e.clientX - r.left : 20, dy: r ? e.clientY - r.top : 20, w: r?.width || 280, moved: false }
    setDrag({ taskId: task.id, drop })
  }

  // ------------------------------------------------------------------

  if (fatal) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-6 text-center">
        <p className="text-base font-semibold text-[var(--text-primary)]">{fatal}</p>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    )
  }

  const lists = [...state.lists].sort((a, b) => a.position - b.position)
  // Filtro «Persona» (solo admin): quello che vede quella persona.
  const shown = state.me.admin && person ? { ...state, tasks: state.tasks.filter((t) => taskVisibleTo(t, person)) } : state
  const dragged = drag ? state.tasks.find((t) => t.id === drag.taskId) : null
  const current = openTask ? state.tasks.find((t) => t.id === openTask) : null

  const addTask = async (list: TodoList) => {
    const title = (adding[list.id] || '').trim()
    if (!title) return
    setAdding((a) => ({ ...a, [list.id]: '' }))
    await run({ op: 'addTask', listId: list.id, fields: { title } })
  }

  const listActions = (list: TodoList, index: number) => [
    { label: 'Rinomina', icon: Pencil, act: () => setEditingList(list.id) },
    { label: 'Ordina per importanza', icon: ArrowDownWideNarrow, act: () => run({ op: 'sortList', listId: list.id }) },
    ...(index > 0
      ? [{ label: 'Sposta a sinistra', icon: ChevronLeft, act: () => run({ op: 'moveList', listId: list.id, index: index - 1 }, (s) => ({ ...s, lists: swapLists(s.lists, list.id, -1) })) }]
      : []),
    ...(index < lists.length - 1
      ? [{ label: 'Sposta a destra', icon: ChevronRight, act: () => run({ op: 'moveList', listId: list.id, index: index + 1 }, (s) => ({ ...s, lists: swapLists(s.lists, list.id, 1) })) }]
      : []),
    {
      label: 'Elimina tabella',
      icon: Trash2,
      danger: true,
      act: () => {
        const count = state.tasks.filter((t) => t.list_id === list.id).length
        if (!window.confirm(`Eliminare la tabella «${list.title}»${count ? ` e le sue ${count} attività` : ''}? Non si può annullare.`)) return
        run({ op: 'deleteList', listId: list.id }, (s) => ({ ...s, lists: s.lists.filter((l) => l.id !== list.id), tasks: s.tasks.filter((t) => t.list_id !== list.id) }))
      },
    },
  ]

  return (
    <div className="pb-24" style={drag ? { userSelect: 'none', WebkitUserSelect: 'none' } : undefined}>
      {!state.me.admin && (
        <p className="mb-2 px-4 text-sm text-[var(--text-secondary)]">
          Ciao <strong className="text-[var(--text-primary)]">{state.me.name}</strong>: qui vedi le attività assegnate a te, quelle che hai creato tu e quelle per tutti.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-4">
        <p className="text-xs text-[var(--text-secondary)]">Trascina con la maniglia <GripVertical className="inline h-3.5 w-3.5" /> oppure apri un’attività per spostarla.</p>
        {state.me.admin && state.members.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            Persona
            <select value={person} onChange={(e) => setPerson(e.target.value)} className="min-h-[36px] rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 text-xs text-[var(--text-primary)]">
              <option value="">Tutte le attività</option>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  Quello che vede {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={refresh} className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]" aria-label="Aggiorna">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Aggiorna
        </button>
      </div>

      <div ref={scrollerRef} className={`flex items-start gap-3 overflow-x-auto px-4 pb-4 ${drag ? '' : 'snap-x snap-mandatory md:snap-none'}`}>
        {lists.map((list, li) => {
          const tasks = tasksOf(shown, list.id)
          const others = drag ? tasks.filter((t) => t.id !== drag.taskId) : tasks
          let oi = 0
          const dropHere = drag?.drop?.listId === list.id ? drag.drop.index : -1
          const doneCount = tasks.filter((t) => t.done).length
          return (
            <section
              key={list.id}
              data-list-id={list.id}
              className={`w-[86vw] max-w-[340px] shrink-0 snap-start rounded-2xl border bg-[var(--background-secondary)] p-2 sm:w-[300px] ${dropHere >= 0 ? 'border-[var(--accent-blue)]' : 'border-[var(--border-color)]'}`}
            >
              <header className="relative flex items-center gap-1 px-1 pb-2 pt-1">
                {editingList === list.id ? (
                  <form
                    className="flex-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const title = String(new FormData(e.currentTarget).get('t') || '').trim()
                      setEditingList(null)
                      if (title && title !== list.title) run({ op: 'renameList', listId: list.id, title }, (s) => ({ ...s, lists: s.lists.map((l) => (l.id === list.id ? { ...l, title } : l)) }))
                    }}
                  >
                    <input
                      name="t"
                      autoFocus
                      defaultValue={list.title}
                      maxLength={120}
                      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                      className="w-full rounded-lg border border-[var(--accent-blue)] bg-[var(--background)] px-2 py-1.5 text-base font-semibold text-[var(--text-primary)] outline-none md:text-sm"
                    />
                  </form>
                ) : list.can_manage ? (
                  <button type="button" onClick={() => setEditingList(list.id)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--text-primary)]" title="Rinomina">
                    {list.title} <span className="font-normal text-[var(--text-secondary)]">· {tasks.length - doneCount}{doneCount ? ` (+${doneCount} fatte)` : ''}</span>
                    {state.me.admin && list.created_by_member && <span className="ml-1 font-normal text-[var(--text-secondary)]">· di {list.owner_name}</span>}
                    {!state.me.admin && list.created_by_member && <span className="ml-1 font-normal text-[var(--text-secondary)]">· la vedi solo tu</span>}
                  </button>
                ) : (
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]" title={`Tabella di ${list.owner_name}`}>
                    <Lock className="mr-1 inline h-3.5 w-3.5 text-[var(--text-secondary)]" aria-label={`Tabella di ${list.owner_name}`} />
                    {list.title} <span className="font-normal text-[var(--text-secondary)]">· {tasks.length - doneCount}{doneCount ? ` (+${doneCount} fatte)` : ''}</span>
                  </p>
                )}
                {list.can_manage && (
                  <button type="button" onClick={() => setListMenu(listMenu === list.id ? null : list.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--background)]" aria-label="Azioni della tabella">
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                )}
                {listMenu === list.id && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setListMenu(null)} />
                    <div className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] shadow-xl">
                      {listActions(list, li).map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          onClick={() => {
                            setListMenu(null)
                            a.act()
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--background-secondary)] ${'danger' in a && a.danger ? 'text-[#FF3B30]' : 'text-[var(--text-primary)]'}`}
                        >
                          <a.icon className="h-4 w-4" /> {a.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </header>

              <div className="flex min-h-[12px] flex-col gap-2">
                {tasks.map((task) => {
                  // L'attivita' trascinata resta al suo posto (sbiadita); la linea blu mostra dove arrivera'.
                  const isDragged = drag?.taskId === task.id
                  const line = !isDragged && dropHere === oi
                  if (!isDragged) oi++
                  return (
                    <div key={task.id} className={isDragged ? 'opacity-30' : undefined}>
                      {line && <div className="mb-2 h-1 rounded-full bg-[var(--accent-blue)]" />}
                      <TaskCard task={task} now={now} admin={state.me.admin} onOpen={() => setOpenTask(task.id)} onToggle={() => run({ op: 'updateTask', taskId: task.id, fields: { done: !task.done } }, (s) => patchLocally(s, task.id, { done: !task.done }))} onGrip={(e) => startDrag(e, task)} />
                    </div>
                  )
                })}
                {dropHere >= 0 && dropHere === others.length && <div className="h-1 rounded-full bg-[var(--accent-blue)]" />}
              </div>

              {list.can_add && (
              <form
                className="mt-2 flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  addTask(list)
                }}
              >
                <input
                  value={adding[list.id] || ''}
                  onChange={(e) => setAdding((a) => ({ ...a, [list.id]: e.target.value }))}
                  placeholder="Nuova attività…"
                  maxLength={300}
                  className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-transparent bg-[var(--background)] px-2.5 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
                />
                <button type="submit" disabled={!(adding[list.id] || '').trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-blue)] text-white disabled:opacity-40" aria-label="Aggiungi attività">
                  <Plus className="h-5 w-5" />
                </button>
              </form>
              )}
            </section>
          )
        })}

        <form
          className="w-[86vw] max-w-[340px] shrink-0 snap-start rounded-2xl border border-dashed border-[var(--border-color)] p-2 sm:w-[300px]"
          onSubmit={(e) => {
            e.preventDefault()
            const title = newList.trim()
            if (!title) return
            setNewList('')
            run({ op: 'addList', title })
          }}
        >
          <p className="px-1 pb-2 pt-1 text-sm font-semibold text-[var(--text-primary)]">Nuova tabella</p>
          <div className="flex items-center gap-1">
            <input value={newList} onChange={(e) => setNewList(e.target.value)} placeholder="Nome della tabella" maxLength={120} className="min-h-[40px] min-w-0 flex-1 rounded-lg bg-[var(--background-secondary)] px-2.5 text-base text-[var(--text-primary)] outline-none md:text-sm" />
            <button type="submit" disabled={!newList.trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-blue)] text-white disabled:opacity-40" aria-label="Crea tabella">
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </form>
      </div>

      {dragged && (
        <div
          ref={ghostRef}
          className="pointer-events-none fixed left-0 top-0 z-50 opacity-90"
          style={dragRef.current ? { width: dragRef.current.w, transform: `translate(${dragRef.current.x - dragRef.current.dx}px, ${dragRef.current.y - dragRef.current.dy}px)` } : { width: 280 }}
        >
          <TaskCard task={dragged} now={now} admin={state.me.admin} onOpen={() => undefined} onToggle={() => undefined} onGrip={() => undefined} lifted />
        </div>
      )}

      {current && (
        <TaskModal
          token={token}
          task={current}
          lists={lists.filter((l) => canDropIn(l, current))}
          listTasks={tasksOf(state, current.list_id)}
          members={state.members}
          admin={state.me.admin}
          run={run}
          onClose={() => setOpenTask(null)}
          onMessage={setMessage}
          refresh={refresh}
        />
      )}

      {message && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4" role="alert">
          <p className="max-w-md rounded-xl bg-[#1c1c1e] px-4 py-3 text-sm text-white shadow-xl">{message}</p>
        </div>
      )}
    </div>
  )
}

function swapLists(lists: TodoList[], id: string, dir: -1 | 1): TodoList[] {
  const sorted = [...lists].sort((a, b) => a.position - b.position)
  const i = sorted.findIndex((l) => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sorted.length) return lists
  const a = sorted[i]
  const b = sorted[j]
  return lists.map((l) => (l.id === a.id ? { ...l, position: b.position } : l.id === b.id ? { ...l, position: a.position } : l))
}

function TaskCard({ task, now, admin, onOpen, onToggle, onGrip, lifted }: { task: TodoTask; now: number; admin: boolean; onOpen: () => void; onToggle: () => void; onGrip: (e: React.PointerEvent) => void; lifted?: boolean }) {
  const pr = PRIORITIES.find((p) => p.value === task.priority) || PRIORITIES[0]
  const preview = task.links.find((l) => l.title || l.image)
  return (
    <div
      data-task-id={lifted ? undefined : task.id}
      onClick={onOpen}
      className={`relative cursor-pointer overflow-hidden rounded-xl border bg-[var(--card-background)] p-2.5 pl-3.5 ${lifted ? 'border-[var(--accent-blue)] shadow-2xl' : 'border-[var(--border-color)] hover:border-[var(--accent-blue)]/60'} ${task.priority === 4 && !task.done ? 'ring-1 ring-[#FF3B30]/50' : ''}`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: pr.bar }} aria-hidden />
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${task.done ? 'border-[#34C759] bg-[#34C759] text-white' : 'border-[var(--text-secondary)]'}`}
          aria-label={task.done ? 'Segna come da fare' : 'Segna come fatta'}
        >
          {task.done && <span className="text-[11px] leading-none">✓</span>}
        </button>
        <div className="min-w-0 flex-1">
          <LinkText text={task.title} className={`block break-words text-sm ${task.done ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]'}`} />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {task.priority > 0 && <span className={`rounded-full px-2 py-0.5 font-semibold ${pr.chip}`}>{pr.label}</span>}
            {task.deadline && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${deadlineTone(task, now)}`}>
                <CalendarClock className="h-3 w-3" /> {formatRome(task.deadline)}
              </span>
            )}
            {task.assignee_name && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[var(--text-secondary)]" title="Assegnata a">
                <User className="h-3 w-3" /> {task.assignee_name}
              </span>
            )}
            {admin && task.created_by_member && (
              <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]" title="Creata da">
                <PenLine className="h-3 w-3" /> {task.creator_name}
              </span>
            )}
            {task.notify_email && task.deadline && !task.done && <Bell className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-label="Solleciti attivi" />}
            {task.notes.trim() && <Pencil className="h-3 w-3 text-[var(--text-secondary)]" aria-label="Ha delle note" />}
            {task.links.length > 0 && !preview && <Link2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-label="Ha dei link" />}
            {task.images.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[var(--text-secondary)]">
                <ImageIcon className="h-3.5 w-3.5" /> {task.images.length}
              </span>
            )}
          </div>
          {!task.can_edit && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <Lock className="h-3 w-3 shrink-0" /> Creata da {task.creator_name}: puoi solo spostarla
            </p>
          )}
          {task.images.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              {task.images.slice(0, 3).map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.src} alt={img.name} loading="lazy" className="h-12 w-12 rounded-md object-cover" />
              ))}
            </div>
          )}
          {preview && (
            <a href={preview.url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="mt-2 flex items-center gap-2 overflow-hidden rounded-lg border border-[var(--border-color)] p-1.5">
              {preview.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded object-cover" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--text-primary)]">{preview.title || preview.url}</span>
                <span className="block truncate text-[11px] text-[var(--text-secondary)]">{preview.site || new URL(preview.url).hostname}</span>
              </span>
            </a>
          )}
        </div>
        <button
          type="button"
          onPointerDown={onGrip}
          onClick={(e) => e.stopPropagation()}
          className="-mr-1 inline-flex h-10 w-9 shrink-0 cursor-grab touch-none select-none items-center [-webkit-touch-callout:none] justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] active:cursor-grabbing"
          aria-label="Trascina per spostare"
        >
          <GripVertical className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
