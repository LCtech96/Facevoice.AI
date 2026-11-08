'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Bell, ExternalLink, ImagePlus, Loader2, Lock, Trash2, X } from 'lucide-react'
import { EMAIL_RE, PRIORITIES, formatRome, isoToRomeInput, romeInputToIso, type TodoBoardState, type TodoList, type TodoMember, type TodoTask } from '@/lib/todo-shared'
import { moveLocally, patchLocally, uploadImage, type OpResult } from './todo-api'
import LinkText from './LinkText'

// Scheda di un'attivita': titolo, note (con i link cliccabili e le anteprime), fatta,
// importanza, sposta, scadenza e solleciti via email, foto. Ogni campo si salva da
// solo (al cambio o quando si esce dal campo); i campi che non si stanno scrivendo si
// aggiornano con le modifiche fatte da altri. Le attivita' create da altri (per una
// persona: quelle dell'admin o di un'altra persona) si possono solo spostare e segnare
// come fatte: il resto si vede ma non si cambia (e il server lo rifiuta comunque).

type Draft = {
  title: string
  notes: string
  deadline: string
  notify_email: string
}

const fromTask = (t: TodoTask): Draft => ({
  title: t.title,
  notes: t.notes,
  deadline: isoToRomeInput(t.deadline),
  notify_email: t.notify_email || '',
})

const START_OPTIONS = [
  { h: 1, label: '1 ora prima' },
  { h: 2, label: '2 ore prima' },
  { h: 3, label: '3 ore prima' },
  { h: 6, label: '6 ore prima' },
  { h: 12, label: '12 ore prima' },
  { h: 24, label: '1 giorno prima' },
  { h: 48, label: '2 giorni prima' },
  { h: 72, label: '3 giorni prima' },
  { h: 168, label: '7 giorni prima' },
]

type Run = (body: Record<string, unknown>, local?: (s: TodoBoardState) => TodoBoardState) => Promise<OpResult>

const input =
  'w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const label = 'mb-1 block text-xs font-medium text-[var(--text-secondary)]'

export default function TaskModal({
  token,
  task,
  lists,
  listTasks,
  members,
  admin,
  run,
  onClose,
  onMessage,
  refresh,
}: {
  token: string
  task: TodoTask
  lists: TodoList[]
  listTasks: TodoTask[]
  members: TodoMember[]
  admin: boolean
  run: Run
  onClose: () => void
  onMessage: (m: string) => void
  refresh: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => fromTask(task))
  const dirty = useRef(new Set<keyof Draft>())
  const [uploading, setUploading] = useState(0)
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const readOnly = !task.can_edit

  // Modifiche fatte da altri: si aggiornano solo i campi che qui non si stanno scrivendo.
  useEffect(() => {
    const fresh = fromTask(task)
    setDraft((d) => {
      const next = { ...d }
      for (const k of Object.keys(fresh) as (keyof Draft)[]) if (!dirty.current.has(k)) next[k] = fresh[k]
      return next
    })
  }, [task])

  const edit = (k: keyof Draft, v: string) => {
    dirty.current.add(k)
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const save = async (fields: Record<string, unknown>, keys: (keyof Draft)[] = []) => {
    const r = await run({ op: 'updateTask', taskId: task.id, fields }, (s) => patchLocally(s, task.id, fields as Partial<TodoTask>))
    keys.forEach((k) => dirty.current.delete(k))
    return r
  }

  /** Salva un campo di testo quando si esce dal campo (solo se e' cambiato). */
  const commit = async (k: keyof Draft) => {
    if (!dirty.current.has(k)) return
    if (readOnly) return dirty.current.delete(k)
    const v = draft[k]
    if (k === 'title') {
      const t = v.replace(/\s+/g, ' ').trim()
      if (!t) {
        dirty.current.delete(k)
        setDraft((d) => ({ ...d, title: task.title }))
        return onMessage('Il titolo non può essere vuoto.')
      }
      if (t === task.title) return dirty.current.delete(k)
      return save({ title: t }, [k])
    }
    if (k === 'notes') return v === task.notes ? dirty.current.delete(k) : save({ notes: v }, [k])
    if (k === 'notify_email') {
      const e = v.trim().toLowerCase()
      if (e && !EMAIL_RE.test(e)) return onMessage('Indirizzo email non valido.')
      return e === (task.notify_email || '') ? dirty.current.delete(k) : save({ notify_email: e }, [k])
    }
    if (k === 'deadline') {
      const iso = romeInputToIso(v)
      if (v && !iso) return onMessage('Scadenza non valida.')
      if ((iso || null) === (task.deadline ? new Date(task.deadline).toISOString() : null)) return dirty.current.delete(k)
      return save({ deadline: iso }, [k])
    }
  }

  const close = async () => {
    const keys = Array.from(dirty.current)
    onClose()
    for (const k of keys) await commit(k)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (viewer) setViewer(null)
      else void close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const index = listTasks.findIndex((t) => t.id === task.id)
  const moveTo = (listId: string, idx: number) => run({ op: 'moveTask', taskId: task.id, listId, index: idx }, (s) => moveLocally(s, task.id, listId, idx))

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files || [])
    if (fileRef.current) fileRef.current.value = ''
    if (!list.length) return
    setUploading((n) => n + list.length)
    for (const file of list) {
      const problem = await uploadImage(token, task.id, file)
      if (problem) onMessage(problem)
      setUploading((n) => n - 1)
    }
    refresh()
  }

  const remove = async () => {
    if (!window.confirm(`Eliminare l’attività «${task.title}»? Non si può annullare.`)) return
    onClose()
    await run({ op: 'deleteTask', taskId: task.id }, (s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== task.id) }))
  }

  const reminderReady = Boolean(task.deadline && (task.notify_email || task.assignee_member))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6" onClick={() => void close()}>
      <div
        className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[var(--border-color)] bg-[var(--card-background)] md:max-h-[92vh] md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Attività"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" checked={task.done} disabled={!task.can_move} onChange={(e) => save({ done: e.target.checked })} className="h-5 w-5 accent-[#34C759]" />
            {task.done ? 'Fatta' : 'Da fare'}
          </label>
          {readOnly && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-[var(--text-secondary)]">
              <Lock className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Creata da {task.creator_name}: puoi solo spostarla</span>
            </span>
          )}
          <button type="button" onClick={() => void close()} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-[var(--background-secondary)]" aria-label="Chiudi">
            <X className="h-5 w-5 text-[var(--text-primary)]" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div>
            <label className={label} htmlFor="todo-title">
              Titolo
            </label>
            <input id="todo-title" value={draft.title} readOnly={readOnly} maxLength={300} onChange={(e) => edit('title', e.target.value)} onBlur={() => commit('title')} className={`${input} font-semibold`} />
          </div>

          <div>
            <span className={label}>Importanza</span>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() => p.value !== task.priority && save({ priority: p.value })}
                  className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${task.priority === p.value ? `${p.chip} ring-2 ring-[var(--accent-blue)]` : 'border border-[var(--border-color)] text-[var(--text-secondary)]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="todo-notes">
              Note (i link restano cliccabili)
            </label>
            <textarea id="todo-notes" value={draft.notes} readOnly={readOnly} maxLength={5000} rows={4} onChange={(e) => edit('notes', e.target.value)} onBlur={() => commit('notes')} className={`${input} resize-y`} placeholder="Dettagli, link, cose da ricordare…" />
            {task.notes.trim() && !dirty.current.has('notes') && /https?:\/\/|www\./i.test(task.notes) && (
              <LinkText text={task.notes} className="mt-1 block whitespace-pre-wrap break-words text-xs text-[var(--text-secondary)]" />
            )}
          </div>

          {task.links.length > 0 && (
            <div className="space-y-2">
              <span className={label}>Link</span>
              {task.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="flex gap-3 overflow-hidden rounded-xl border border-[var(--border-color)] p-2 hover:border-[var(--accent-blue)]">
                  {l.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg object-cover sm:h-20 sm:w-28" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text-primary)]">
                      <span className="truncate">{l.title || l.url}</span> <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </span>
                    {l.description && <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--text-secondary)]">{l.description}</span>}
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--accent-blue)]">{l.site || safeHost(l.url)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={label}>Immagini</span>
              {!readOnly && <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)] disabled:opacity-50">
                {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {uploading > 0 ? 'Caricamento…' : 'Carica immagini'}
              </button>}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
            {task.images.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {task.images.map((img) => (
                  <div key={img.id} className="group relative">
                    <button type="button" onClick={() => setViewer(img)} className="block w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.src} alt={img.name} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
                    </button>
                    {!readOnly && <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Togliere questa immagine?')) run({ op: 'removeImage', taskId: task.id, imageId: img.id }, (s) => patchLocally(s, task.id, { images: task.images.filter((i) => i.id !== img.id) }))
                      }}
                      className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                      aria-label="Togli immagine"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">{readOnly ? 'Nessuna immagine.' : 'Nessuna immagine. JPG, PNG, WEBP o GIF fino a 10 MB.'}</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-color)] p-3">
            <span className={label}>Sposta</span>
            <div className="flex flex-wrap items-center gap-2">
              <select value={task.list_id} onChange={(e) => moveTo(e.target.value, 999_999)} className={`${input} w-auto min-w-0 flex-1`} aria-label="Sposta in">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
              <button type="button" disabled={index <= 0} onClick={() => moveTo(task.list_id, index - 1)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 text-sm text-[var(--text-primary)] disabled:opacity-40">
                <ArrowUp className="h-4 w-4" /> Su
              </button>
              <button type="button" disabled={index < 0 || index >= listTasks.length - 1} onClick={() => moveTo(task.list_id, index + 1)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 text-sm text-[var(--text-primary)] disabled:opacity-40">
                <ArrowDown className="h-4 w-4" /> Giù
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-color)] p-3">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Bell className="h-4 w-4" /> Scadenza e solleciti
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="todo-deadline">
                  Scadenza (ora italiana)
                </label>
                <div className="flex gap-1">
                  <input id="todo-deadline" type="datetime-local" disabled={readOnly} value={draft.deadline} onChange={(e) => edit('deadline', e.target.value)} onBlur={() => commit('deadline')} className={input} />
                  {draft.deadline && !readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        dirty.current.delete('deadline')
                        setDraft((d) => ({ ...d, deadline: '' }))
                        save({ deadline: null })
                      }}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)]"
                      aria-label="Togli la scadenza"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className={label} htmlFor="todo-assignee">
                  A chi è assegnata
                </label>
                <select
                  id="todo-assignee"
                  value={task.assignee_member || ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const id = e.target.value || null
                    const name = members.find((m) => m.id === id)?.name || null
                    void run({ op: 'updateTask', taskId: task.id, fields: { assignee_member: id } }, (s) => patchLocally(s, task.id, { assignee_member: id, assignee_name: name, assignee: name }))
                  }}
                  className={input}
                >
                  <option value="">Nessuno{admin ? ' (la vedono tutti)' : ''}</option>
                  {task.assignee_member && !members.some((m) => m.id === task.assignee_member) && <option value={task.assignee_member}>{task.assignee_name || 'Persona rimossa'}</option>}
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {!task.assignee_member && task.assignee && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Prima: {task.assignee}</p>}
                {admin && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Creata da {task.creator_name}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="todo-email">
                  Email a cui mandare i solleciti
                </label>
                <input id="todo-email" type="email" inputMode="email" autoCapitalize="none" readOnly={readOnly} value={draft.notify_email} maxLength={200} onChange={(e) => edit('notify_email', e.target.value)} onBlur={() => commit('notify_email')} className={input} placeholder={task.assignee_member ? 'Se vuota: l’email della persona assegnata' : 'nome@esempio.it'} />
              </div>
              <div>
                <label className={label} htmlFor="todo-perday">
                  Solleciti al giorno
                </label>
                <select id="todo-perday" disabled={readOnly} value={task.reminders_per_day} onChange={(e) => save({ reminders_per_day: Number(e.target.value) })} className={input}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'volta' : 'volte'} al giorno
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="todo-start">
                  Inizia a sollecitare
                </label>
                <select id="todo-start" disabled={readOnly} value={task.remind_hours_before} onChange={(e) => save({ remind_hours_before: Number(e.target.value) })} className={input}>
                  {(START_OPTIONS.some((o) => o.h === task.remind_hours_before) ? START_OPTIONS : [...START_OPTIONS, { h: task.remind_hours_before, label: `${task.remind_hours_before} ore prima` }]).map((o) => (
                    <option key={o.h} value={o.h}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {reminderReady
                ? task.done
                  ? 'Attività fatta: nessun sollecito.'
                  : `Le email partono da ${START_OPTIONS.find((o) => o.h === task.remind_hours_before)?.label || `${task.remind_hours_before} ore prima`} della scadenza (${formatRome(task.deadline)}), fino a ${task.reminders_per_day} al giorno tra le 8 e le 20, finché l’attività non è fatta.`
                : 'Per i solleciti servono la scadenza e l’email (o una persona assegnata con la sua email).'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-color)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {readOnly ? (
            <span />
          ) : (
            <button type="button" onClick={remove} className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-4 text-sm text-[#FF3B30]">
              <Trash2 className="h-4 w-4" /> Elimina
            </button>
          )}
          <button type="button" onClick={() => void close()} className="inline-flex min-h-[40px] items-center rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white">
            Fatto
          </button>
        </div>
      </div>

      {viewer && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/90" onClick={(e) => (e.stopPropagation(), setViewer(null))}>
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="truncate text-sm text-white">{viewer.name}</span>
            <span className="flex gap-2">
              <a href={viewer.src} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex h-10 items-center gap-1 rounded-full bg-white/15 px-3 text-sm text-white">
                <ExternalLink className="h-4 w-4" /> Apri
              </a>
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Chiudi">
                <X className="h-5 w-5" />
              </button>
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewer.src} alt={viewer.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  )
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
