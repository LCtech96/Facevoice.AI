'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  Download,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Save,
  X,
} from 'lucide-react'
import Navigation from '@/components/Navigation'
import { getAccessToken } from '@/lib/session-token'
import { useStaffAccess } from '@/components/useStaffAccess'
import { saveFile } from '@/lib/phone-export'

// Rubrica: tutti i contatti in un posto solo. Ci finiscono da soli quelli trovati
// con le ricerche (pagina Clienti), quelli inseriti qui a mano e quelli dettati o
// scritti alla super chat.

type Contact = {
  id: string
  place_id: string | null
  search_query: string | null
  name: string
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  instagram: string | null
  facebook: string | null
  rating: number | null
  maps_url: string | null
  status: string
  notes: string | null
  called_at: string | null
  contacted_at: string | null
  created_at: string
}

type Source = 'search' | 'manual' | 'chat'
const SOURCE_LABEL: Record<Source, string> = { search: 'Ricerca', manual: 'A mano', chat: 'Super chat' }
const SOURCE_COLOR: Record<Source, string> = { search: '#0A84FF', manual: '#34C759', chat: '#AF52DE' }

const STATUS_LABEL: Record<string, string> = {
  new: 'Da contattare',
  contacted: 'Contattato',
  no_answer: 'Non ha risposto',
  replied: 'Ha risposto',
  client: 'Cliente',
  discarded: 'Scartato',
  do_not_contact: 'Non contattare',
}

const FIELDS = [
  { key: 'name', label: 'Nome *', placeholder: 'Es. Pizzeria Da Mario o Mario Rossi', type: 'text' },
  { key: 'phone', label: 'Telefono', placeholder: '+39 333 123 4567', type: 'tel' },
  { key: 'email', label: 'Email', placeholder: 'nome@esempio.it', type: 'email' },
  { key: 'website', label: 'Sito', placeholder: 'www.esempio.it', type: 'text' },
  { key: 'address', label: 'Indirizzo', placeholder: 'Via, città', type: 'text' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/…', type: 'text' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/…', type: 'text' },
] as const

type Form = Record<(typeof FIELDS)[number]['key'] | 'notes', string>
const EMPTY: Form = { name: '', phone: '', email: '', website: '', address: '', instagram: '', facebook: '', notes: '' }

function sourceOf(c: Contact): Source {
  if (c.search_query === 'Super chat') return 'chat'
  if (c.search_query === 'Inserito a mano' || !c.place_id) return 'manual'
  return 'search'
}

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

const csvCell = (value: string) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export default function ContactsPage() {
  const staff = useStaffAccess()
  const canEdit = staff.can('contacts', 'edit')
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [openId, setOpenId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Form>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/contacts').catch(() => null)
    if (!res) return
    if (res.status === 401 || res.status === 403) return setAuthorized(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setNotice(data.error || 'Errore nel caricare i contatti')
    setAuthorized(true)
    setContacts(data.contacts || [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Si aggiorna da solo: le nuove ricerche e i contatti dettati alla super chat compaiono qui.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 15_000)
    return () => clearInterval(timer)
  }, [load])

  const counts = useMemo(() => {
    const c = { all: contacts.length, search: 0, manual: 0, chat: 0 }
    for (const contact of contacts) c[sourceOf(contact)]++
    return c
  }, [contacts])

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return contacts.filter((c) => {
      if (source !== 'all' && sourceOf(c) !== source) return false
      if (!words.length) return true
      const hay = [c.name, c.phone, c.email, c.address, c.website, c.notes, c.search_query, c.instagram, c.facebook]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [contacts, query, source])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/contacts', { method: 'POST', body: JSON.stringify(form) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice(data.error || 'Contatto non salvato, riprova.')
    setContacts((list) => [data.contact, ...list.filter((c) => c.id !== data.contact.id)])
    setForm(EMPTY)
    setAdding(false)
    setNotice(data.created ? `Aggiunto: ${data.contact.name}` : `${data.contact.name} era già in rubrica: ho completato i dati mancanti.`)
  }

  const openContact = (c: Contact) => {
    if (openId === c.id) return setOpenId(null)
    setOpenId(c.id)
    setEdit({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      website: c.website || '',
      address: c.address || '',
      instagram: c.instagram || '',
      facebook: c.facebook || '',
      notes: c.notes || '',
    })
  }

  const saveEdit = async (c: Contact) => {
    if (!edit.name.trim()) return setNotice('Il nome non può essere vuoto.')
    setBusy(true)
    const res = await authFetch(`/api/admin/contacts/${c.id}`, { method: 'PATCH', body: JSON.stringify(edit) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice(data.error || 'Modifiche non salvate, riprova.')
    setContacts((list) => list.map((x) => (x.id === c.id ? data.contact : x)))
    setOpenId(null)
    setNotice('Modifiche salvate.')
  }

  const remove = async (c: Contact) => {
    if (!window.confirm(`Eliminare ${c.name} dalla rubrica? Sparisce anche dalla pagina Clienti.`)) return
    const res = await authFetch(`/api/admin/contacts/${c.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) return setNotice('Eliminazione non riuscita.')
    setContacts((list) => list.filter((x) => x.id !== c.id))
    setOpenId(null)
  }

  const exportCsv = async () => {
    const header = ['Nome', 'Telefono', 'Email', 'Sito', 'Indirizzo', 'Instagram', 'Facebook', 'Stato', 'Chiamato', 'Origine', 'Ricerca', 'Note', 'Aggiunto il']
    const lines = visible.map((c) =>
      [
        c.name,
        c.phone || '',
        c.email || '',
        c.website || '',
        c.address || '',
        c.instagram || '',
        c.facebook || '',
        STATUS_LABEL[c.status] || c.status,
        c.called_at ? new Date(c.called_at).toLocaleDateString('it-IT') : '',
        SOURCE_LABEL[sourceOf(c)],
        sourceOf(c) === 'search' ? c.search_query || '' : '',
        (c.notes || '').replace(/\s+/g, ' '),
        new Date(c.created_at).toLocaleDateString('it-IT'),
      ]
        .map(csvCell)
        .join(';')
    )
    const csv = `﻿${[header.join(';'), ...lines].join('\r\n')}\r\n`
    await saveFile(csv, `contatti-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
  }

  if (authorized === false) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <p className="pt-32 text-center text-[var(--text-secondary)]">Non hai accesso a questa pagina: chiedilo all’amministratore.</p>
      </main>
    )
  }

  const input =
    'w-full px-3 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[16px] sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent-blue)]'
  const chip = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
      active ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
    }`

  const fieldsForm = (value: Form, set: (f: Form) => void) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-[11px] text-[var(--text-secondary)] mb-1">{f.label}</span>
          <input
            type={f.type}
            value={value[f.key]}
            onChange={(e) => set({ ...value, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            className={input}
          />
        </label>
      ))}
      <label className="block sm:col-span-2">
        <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Note</span>
        <textarea
          value={value.notes}
          onChange={(e) => set({ ...value, notes: e.target.value })}
          rows={3}
          placeholder="Chi è, cosa gli serve, quando richiamarlo…"
          className={input}
        />
      </label>
    </div>
  )

  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <div className="max-w-5xl mx-auto px-4 pt-20 md:pt-24 pb-28 md:pb-10">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Contatti</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Tutti i clienti in un posto solo: quelli trovati con le ricerche, quelli inseriti qui e quelli dettati alla super chat.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              disabled={!visible.length}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)] disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            {canEdit && (
              <button
                onClick={() => setAdding((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium"
              >
                {adding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {adding ? 'Chiudi' : 'Nuovo contatto'}
              </button>
            )}
          </div>
        </div>

        {notice && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--background-secondary)] text-sm text-[var(--text-primary)] flex justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-[var(--text-secondary)]" aria-label="Chiudi">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {adding && canEdit && (
          <form onSubmit={create} className="mb-4 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
            {fieldsForm(form, setForm)}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--text-secondary)] inline-flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Puoi anche dettarlo alla super chat: &quot;aggiungi Mario Rossi, 333…&quot;
              </p>
              <button
                type="submit"
                disabled={busy || !form.name.trim()}
                className="px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Salvo…' : 'Salva contatto'}
              </button>
            </div>
          </form>
        )}

        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome, telefono, email, città, note…"
            className={`${input} pl-9`}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          {(['all', 'search', 'manual', 'chat'] as const).map((s) => (
            <button key={s} onClick={() => setSource(s)} className={chip(source === s)}>
              {s === 'all' ? 'Tutti' : SOURCE_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>

        {authorized === null && <p className="text-sm text-[var(--text-secondary)] p-4">Caricamento…</p>}
        {authorized && visible.length === 0 && (
          <p className="text-sm text-[var(--text-secondary)] p-6 text-center">
            {contacts.length ? 'Nessun contatto con questi filtri.' : 'Ancora nessun contatto.'}
          </p>
        )}

        <div className="space-y-2">
          {visible.map((c) => {
            const src = sourceOf(c)
            const open = openId === c.id
            return (
              <div key={c.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]">
                <button onClick={() => openContact(c)} className="w-full text-left p-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-medium text-[var(--text-primary)] break-words">{c.name}</p>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ color: SOURCE_COLOR[src], backgroundColor: `${SOURCE_COLOR[src]}22` }}
                      >
                        {SOURCE_LABEL[src]}
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)]">{STATUS_LABEL[c.status] || c.status}</span>
                      {c.called_at && <span className="text-[11px] text-[#34C759]">chiamato</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                      {c.phone && <span>{c.phone}</span>}
                      {c.email && <span className="break-all">{c.email}</span>}
                      {c.address && <span className="truncate max-w-full">{c.address}</span>}
                    </div>
                    {c.notes && !open && <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-1">{c.notes}</p>}
                  </div>
                  <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--border-color)] pt-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      {c.phone && (
                        <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <Phone className="w-3.5 h-3.5" /> Chiama
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <Mail className="w-3.5 h-3.5" /> Email
                        </a>
                      )}
                      {c.website && (
                        <a href={c.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <Globe className="w-3.5 h-3.5" /> Sito
                        </a>
                      )}
                      {c.maps_url && (
                        <a href={c.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <MapPin className="w-3.5 h-3.5" /> Maps
                        </a>
                      )}
                      {c.instagram && (
                        <a href={c.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <Instagram className="w-3.5 h-3.5" /> Instagram
                        </a>
                      )}
                      {c.facebook && (
                        <a href={c.facebook} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                          <Facebook className="w-3.5 h-3.5" /> Facebook
                        </a>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Aggiunto il {new Date(c.created_at).toLocaleDateString('it-IT')}
                      {src === 'search' && c.search_query ? ` · trovato cercando “${c.search_query}”` : ''}
                      {c.rating !== null ? ` · ${c.rating}★ su Google` : ''}
                    </p>

                    {canEdit ? (
                      <>
                        {fieldsForm(edit, setEdit)}
                        <div className="flex flex-wrap justify-between gap-2">
                          <button
                            onClick={() => remove(c)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-[#FF3B30] border border-[var(--border-color)]"
                          >
                            <Trash2 className="w-4 h-4" /> Elimina
                          </button>
                          <button
                            onClick={() => saveEdit(c)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
                          >
                            <Save className="w-4 h-4" /> {busy ? 'Salvo…' : 'Salva modifiche'}
                          </button>
                        </div>
                      </>
                    ) : (
                      c.notes && <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{c.notes}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
