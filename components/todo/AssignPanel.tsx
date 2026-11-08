'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2, Mail, Sparkles, UserPlus, X } from 'lucide-react'
import { EMAIL_RE, LIMITS, nameKey, type TodoBoardState, type TodoMember, type TodoTask } from '@/lib/todo-shared'
import { patchLocally, type OpResult } from './todo-api'

// «Assegna a» (solo admin): si sceglie una persona della todo list oppure si scrive un
// nome nuovo. Per un nome nuovo servono email (per l'invito e gli avvisi) e password
// (per entrare): salvando, il server crea la persona e assegna l'attivita' insieme; se
// la persona non si crea, l'attivita' resta com'era. Il nome e' quello con cui la
// persona entra dal link. La password non resta da nessuna parte: va al server solo
// per l'hash e, se si spunta la casella, finisce in quella sola email di invito.

type Run = (body: Record<string, unknown>, local?: (s: TodoBoardState) => TodoBoardState) => Promise<OpResult>

const input =
  'w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const label = 'mb-1 block text-xs font-medium text-[var(--text-secondary)]'

/** Password facile da dettare: niente caratteri che si confondono (0/O, 1/l/I). */
function generatePassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

type InviteInfo = { status: 'sent' | 'failed' | 'already' | 'no-email'; name: string; email: string | null; created: boolean }

function inviteMessage(i: InviteInfo): { text: string; warn: boolean } {
  const who = i.name
  if (i.status === 'sent') return { text: `${i.created ? `Persona creata: ${who}. ` : ''}Invito mandato a ${who}${i.email ? ` (${i.email})` : ''}.`, warn: false }
  if (i.status === 'failed') return { text: `Assegnazione salvata, ma l’email a ${who} non è partita. Riprova più tardi o mandale tu il link.`, warn: true }
  if (i.status === 'no-email') return { text: `Assegnazione salvata. ${who} non ha l’email: niente invito né avvisi.`, warn: true }
  return { text: `Assegnazione salvata. ${who} aveva già ricevuto l’invito per questa attività.`, warn: false }
}

export default function AssignPanel({ task, members, run, focus }: { task: TodoTask; members: TodoMember[]; run: Run; focus?: boolean }) {
  const current = members.find((m) => m.id === task.assignee_member) || null
  const legacy = !task.assignee_member && task.assignee ? task.assignee : null
  const [who, setWho] = useState(() => current?.name || legacy || '')
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [changePw, setChangePw] = useState(false)
  const [includePw, setIncludePw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const key = nameKey(who)
  const matched = key ? members.find((m) => nameKey(m.name) === key) || null : null
  const mode: 'none' | 'existing' | 'new' = !key ? 'none' : matched ? 'existing' : 'new'
  const settingPassword = mode === 'new' || (mode === 'existing' && changePw)

  // Persona scelta: l'email si riempie con la sua (si puo' cambiare).
  useEffect(() => {
    setEmail(matched?.email || '')
    setChangePw(false)
    setPassword('')
    setIncludePw(false)
    setError(null)
  }, [matched?.id, matched?.email])

  // Aperta dal bollino «Da collegare»: si parte dall'email.
  useEffect(() => {
    if (!focus) return
    boxRef.current?.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => emailRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [focus])

  const suggestions = useMemo(() => {
    const k = nameKey(who)
    const list = k && !matched ? members.filter((m) => nameKey(m.name).includes(k)) : members
    return list.slice(0, 8)
  }, [who, members, matched])

  const cleanEmail = email.trim().toLowerCase()
  const unchanged =
    (mode === 'none' && !task.assignee_member && !legacy) ||
    (mode === 'existing' && matched?.id === task.assignee_member && cleanEmail === (matched?.email || '') && !(changePw && password))

  const save = async () => {
    setError(null)
    setNotice(null)
    if (mode === 'none') {
      setSaving(true)
      const r = await run({ op: 'updateTask', taskId: task.id, fields: { assignee_member: null } }, (s) => patchLocally(s, task.id, { assignee_member: null, assignee_name: null, assignee: null }))
      setSaving(false)
      if (!r.ok) setError(r.error)
      else setNotice({ text: 'Ora l’attività non è assegnata a nessuno (la vedono tutti).', warn: false })
      return
    }
    if (mode === 'new' && !cleanEmail) return setError(`Scrivi l’email di ${who.trim()}: serve per mandare l’invito.`)
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return setError('Indirizzo email non valido.')
    if (settingPassword && password.length < LIMITS.passwordMin) return setError(`La password deve avere almeno ${LIMITS.passwordMin} caratteri.`)
    const assign: Record<string, unknown> =
      mode === 'existing' && matched
        ? { memberId: matched.id, email: cleanEmail, ...(changePw && password ? { password } : {}) }
        : { name: who.replace(/\s+/g, ' ').trim(), email: cleanEmail, password }
    if (settingPassword && includePw) assign.includePassword = true
    setSaving(true)
    const r = await run({ op: 'updateTask', taskId: task.id, fields: {}, assign })
    setSaving(false)
    if (!r.ok) return setError(r.error)
    setPassword('')
    setChangePw(false)
    setIncludePw(false)
    setShow(false)
    const info = r.data.invite as InviteInfo | undefined
    setNotice(info ? inviteMessage(info) : { text: 'Assegnazione salvata.', warn: false })
  }

  const button = mode === 'none' ? 'Togli l’assegnazione' : mode === 'new' ? `Crea ${who.trim()} e assegna` : matched?.id === task.assignee_member ? 'Salva' : `Assegna a ${matched?.name}`

  return (
    <div ref={boxRef} className="rounded-xl border border-[var(--border-color)] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
        <UserPlus className="h-4 w-4" /> Assegna a
      </p>
      {legacy && (
        <p className="mb-2 rounded-lg bg-[#FF9500]/15 px-3 py-2 text-xs text-[var(--text-primary)]">
          Da collegare: <strong>{legacy}</strong> non può ancora entrare. Imposta email e password qui sotto e salva: tutte le attività con questo nome diventano sue.
        </p>
      )}
      <div className="relative">
        <label className={label} htmlFor="todo-assign-who">
          Nome (è anche il nome con cui entra)
        </label>
        <div className="flex gap-1">
          <input
            id="todo-assign-who"
            value={who}
            maxLength={LIMITS.memberName}
            autoComplete="off"
            onChange={(e) => {
              setWho(e.target.value)
              setOpen(true)
              setNotice(null)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Scegli una persona o scrivi un nome nuovo"
            className={input}
            role="combobox"
            aria-expanded={open}
            aria-controls="todo-assign-list"
          />
          {who && (
            <button type="button" onClick={() => setWho('')} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)]" aria-label="Nessuno">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {open && suggestions.length > 0 && (
          <ul id="todo-assign-list" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] shadow-xl">
            {suggestions.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={matched?.id === m.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setWho(m.name)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)]"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="truncate text-xs text-[var(--text-secondary)]">{m.email || 'senza email'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          {mode === 'none' ? 'Nessuno: la vedono tutti.' : mode === 'new' ? `Persona nuova: ${who.trim()} entrerà con questo nome e la password che scegli.` : `${matched?.name} è già nella todo list.`}
        </p>
      </div>

      {mode !== 'none' && (
        <div className="mt-3 grid gap-3">
          <div>
            <label className={label} htmlFor="todo-assign-email">
              Email {mode === 'new' ? '(per l’invito e gli avvisi)' : ''}
            </label>
            <input ref={emailRef} id="todo-assign-email" type="email" inputMode="email" autoCapitalize="none" value={email} maxLength={LIMITS.email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" className={input} />
            {mode === 'existing' && !cleanEmail && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Senza email non riceve l’invito né gli avvisi.</p>}
          </div>

          {mode === 'existing' && !changePw && (
            <button type="button" onClick={() => setChangePw(true)} className="justify-self-start text-xs text-[var(--accent-blue)] underline">
              Cambia password
            </button>
          )}

          {settingPassword && (
            <div>
              <label className={label} htmlFor="todo-assign-pw">
                {mode === 'new' ? 'Password (per entrare dal link)' : 'Password nuova (dovrà rientrare con questa)'}
              </label>
              <div className="flex gap-1">
                <div className="flex min-w-0 flex-1 items-center rounded-lg border border-[var(--border-color)] bg-[var(--background)] pr-1 focus-within:border-[var(--accent-blue)]">
                  <input
                    id="todo-assign-pw"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={LIMITS.passwordMax}
                    placeholder={`Almeno ${LIMITS.passwordMin} caratteri`}
                    className="w-full bg-transparent px-3 py-2 text-base text-[var(--text-primary)] outline-none md:text-sm"
                  />
                  <button type="button" onClick={() => setShow(!show)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)]" aria-label={show ? 'Nascondi password' : 'Mostra password'}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword())
                    setShow(true)
                  }}
                  className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Genera
                </button>
                {mode === 'existing' && (
                  <button type="button" onClick={() => (setChangePw(false), setPassword(''), setIncludePw(false))} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)]" aria-label="Lascia la password di prima">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {settingPassword && (
            <label className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
              <input type="checkbox" checked={includePw} onChange={(e) => setIncludePw(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                Includi la password nell’email
                <span className="block text-[11px] text-[var(--text-secondary)]">Se non la spunti, la password dovrai dargliela tu.</span>
              </span>
            </label>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-xs text-[var(--text-primary)]">{error}</p>}
      {notice && (
        <p className={`mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] ${notice.warn ? 'bg-[#FF9500]/15' : 'bg-[#34C759]/15'}`}>
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice.text}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" disabled={saving || unchanged} onClick={() => void save()} className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-40">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {button}
        </button>
      </div>
    </div>
  )
}
