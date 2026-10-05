'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import Navigation from '@/components/Navigation'
import LeadAssistant from './LeadAssistant'
import { getAccessToken } from '@/lib/session-token'

type Lead = {
  id: string
  search_query: string | null
  name: string
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  instagram: string | null
  facebook: string | null
  rating: number | null
  reviews_count: number | null
  maps_url: string | null
  score: number | null
  analysis: string | null
  email_subject: string | null
  email_body: string | null
  dm_text: string | null
  status: string
  notes: string | null
  analyzed_at: string | null
  contacted_at: string | null
}

const STATUS: Record<string, { label: string; color: string }> = {
  new: { label: 'Da contattare', color: '#8E8E93' },
  contacted: { label: 'Contattato', color: '#0A84FF' },
  replied: { label: 'Ha risposto', color: '#FF9500' },
  client: { label: 'Cliente', color: '#34C759' },
  discarded: { label: 'Scartato', color: '#636366' },
  do_not_contact: { label: 'Non contattare', color: '#FF3B30' },
}

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

function scoreColor(score: number | null) {
  if (score === null) return '#8E8E93'
  if (score >= 7) return '#34C759'
  if (score >= 4) return '#FF9500'
  return '#FF3B30'
}

export default function LeadsPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState(true)
  const [leads, setLeads] = useState<Lead[]>([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [filterText, setFilterText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [max, setMax] = useState(20)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Lead>>({})

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/leads?status=all')
    if (res.status === 401) return setAuthorized(false)
    const data = await res.json()
    if (!res.ok) return setNotice(data.error || 'Errore nel caricamento')
    setAuthorized(true)
    setConfigured(data.configured)
    setLeads(data.leads)
  }, [])

  useEffect(() => {
    load().catch(() => setAuthorized(false))
  }, [load])

  const selected = leads.find((l) => l.id === selectedId) || null

  useEffect(() => {
    if (selected) {
      setDraft({
        email: selected.email || '',
        email_subject: selected.email_subject || '',
        email_body: selected.email_body || '',
        dm_text: selected.dm_text || '',
        notes: selected.notes || '',
      })
    }
    // Solo al cambio di scheda: non sovrascrivere mentre si scrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.analyzed_at])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length }
    for (const l of leads) c[l.status] = (c[l.status] || 0) + 1
    return c
  }, [leads])

  const visible = leads.filter(
    (l) =>
      (statusFilter === 'all' || l.status === statusFilter) &&
      (!filterText.trim() ||
        `${l.name} ${l.search_query || ''} ${l.address || ''}`.toLowerCase().includes(filterText.trim().toLowerCase()))
  )

  const replaceLead = (lead: Lead) => setLeads((list) => list.map((l) => (l.id === lead.id ? lead : l)))

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotice(null)
    setBusy('search')
    try {
      const res = await authFetch('/api/admin/leads', { method: 'POST', body: JSON.stringify({ query, max }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(`Trovate ${data.found} attività, ${data.added} nuove aggiunte alla lista.`)
      setFilterText(query)
      setStatusFilter('all')
      await load()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Ricerca non riuscita')
    } finally {
      setBusy(null)
    }
  }

  const analyze = async (id: string) => {
    const res = await authFetch(`/api/admin/leads/${id}/analyze`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    replaceLead(data.lead)
  }

  const analyzeOne = async (id: string) => {
    setBusy(`analyze:${id}`)
    setNotice(null)
    try {
      await analyze(id)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Analisi non riuscita')
    } finally {
      setBusy(null)
    }
  }

  // Analisi in blocco: 3 alla volta, per non far scadere le richieste.
  const analyzeAll = async () => {
    const todo = visible.filter((l) => !l.analyzed_at && l.status === 'new')
    if (!todo.length) return setNotice('Nessuna scheda da analizzare in questa lista.')
    await analyzeList(todo)
  }

  const analyzeList = async (todo: { id: string }[]) => {
    setBusy('analyze-all')
    let done = 0
    let failed = 0
    const queue = [...todo]
    const worker = async () => {
      while (queue.length) {
        const lead = queue.shift()!
        try {
          await analyze(lead.id)
        } catch {
          failed++
        }
        done++
        setProgress(`Analisi ${done}/${todo.length}…`)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setProgress(null)
    setBusy(null)
    setNotice(`Analisi completata: ${done - failed} schede pronte${failed ? `, ${failed} non riuscite (riprova)` : ''}.`)
  }

  const save = async (fields: Partial<Lead>) => {
    if (!selected) return
    const res = await authFetch(`/api/admin/leads/${selected.id}`, { method: 'PATCH', body: JSON.stringify(fields) })
    const data = await res.json()
    if (!res.ok) return setNotice(data.error)
    replaceLead(data.lead)
  }

  const sendEmail = async () => {
    if (!selected) return
    if (!window.confirm(`Inviare l'email a ${draft.email}?`)) return
    setBusy('send')
    setNotice(null)
    try {
      if (draft.email !== (selected.email || '')) await save({ email: draft.email })
      const res = await authFetch(`/api/admin/leads/${selected.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ subject: draft.email_subject, body: draft.email_body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      replaceLead(data.lead)
      setNotice('Email inviata. Le risposte arriveranno in Messaggi.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Invio non riuscito')
    } finally {
      setBusy(null)
    }
  }

  const copyDm = async () => {
    await navigator.clipboard.writeText(draft.dm_text || '').catch(() => undefined)
    setNotice('Messaggio copiato: incollalo nel Direct e poi segna la scheda come "Contattato".')
  }

  const remove = async () => {
    if (!selected || !window.confirm(`Eliminare ${selected.name} dalla lista?`)) return
    await authFetch(`/api/admin/leads/${selected.id}`, { method: 'DELETE' })
    setLeads((list) => list.filter((l) => l.id !== selected.id))
    setSelectedId(null)
  }

  if (authorized === false) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <p className="pt-32 text-center text-[var(--text-secondary)]">Area riservata agli amministratori.</p>
      </main>
    )
  }

  const input =
    'w-full px-3 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'
  const chip = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
      active
        ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
        : 'border-[var(--border-color)] text-[var(--text-secondary)]'
    }`

  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 pt-20 md:pt-24 pb-28 md:pb-8">
        <div className={selectedId ? 'hidden md:block' : ''}>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Ricerca clienti</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Trova attività su Google Maps, l&apos;AI legge il loro sito e prepara un primo contatto personalizzato. Le
            email partono solo dopo che le hai controllate.
          </p>

          {!configured && (
            <p className="mb-3 px-3 py-2 rounded-lg bg-[#FF9500]/10 text-[#FF9500] text-sm">
              Manca GOOGLE_PLACES_API_KEY nelle variabili di Vercel: la ricerca non funziona finché non la aggiungi.
            </p>
          )}

          <LeadAssistant
            authFetch={authFetch}
            onRefresh={load}
            onAnalyze={(ids) => analyzeList(ids.map((id) => ({ id })))}
          />

          <form onSubmit={runSearch} className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Es. "ristoranti Catania" o "ditta traslochi Palermo"'
              className={input}
            />
            <div className="flex gap-2">
              <select value={max} onChange={(e) => setMax(Number(e.target.value))} className={`${input} w-auto`}>
                {[20, 40, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} risultati
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy !== null || query.trim().length < 3}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
              >
                <Search className="w-4 h-4" /> {busy === 'search' ? 'Cerco…' : 'Cerca'}
              </button>
            </div>
          </form>
        </div>

        {notice && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--background-secondary)] text-sm text-[var(--text-primary)] flex justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-[var(--text-secondary)]" aria-label="Chiudi">
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
          {/* Lista */}
          <section className={`min-w-0 ${selectedId ? 'hidden md:block' : ''}`}>
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
              {['all', ...Object.keys(STATUS)].map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={chip(statusFilter === s)}>
                  {s === 'all' ? 'Tutti' : STATUS[s].label} {counts[s] ? `(${counts[s]})` : ''}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filtra per nome o ricerca…"
                className={input}
              />
              <button
                onClick={analyzeAll}
                disabled={busy !== null}
                title="Analizza le schede nuove di questa lista"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)] disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" /> {progress || 'Analizza nuovi'}
              </button>
            </div>

            <div className="space-y-2">
              {authorized === null && <p className="text-sm text-[var(--text-secondary)] p-4">Caricamento…</p>}
              {authorized && visible.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)] p-4 text-center">
                  Nessuna attività. Fai una ricerca qui sopra.
                </p>
              )}
              {visible.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => setSelectedId(lead.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    lead.id === selectedId
                      ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/5'
                      : 'border-[var(--border-color)] bg-[var(--card-background)]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: scoreColor(lead.score) }}
                      title="Punteggio di priorità"
                    >
                      {lead.score ?? '–'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--text-primary)] truncate">{lead.name}</p>
                      <p className="text-xs text-[var(--text-secondary)] truncate">{lead.address}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                        <span style={{ color: STATUS[lead.status]?.color }}>{STATUS[lead.status]?.label}</span>
                        {lead.rating !== null && (
                          <span className="inline-flex items-center gap-0.5">
                            <Star className="w-3 h-3" /> {lead.rating} ({lead.reviews_count})
                          </span>
                        )}
                        {lead.email && <Mail className="w-3 h-3" />}
                        {lead.instagram && <Instagram className="w-3 h-3" />}
                        {lead.facebook && <Facebook className="w-3 h-3" />}
                        {!lead.website && <span className="text-[#FF9500]">senza sito</span>}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Dettaglio */}
          <section className={`min-w-0 ${selectedId ? '' : 'hidden md:block'}`}>
            {!selected ? (
              <p className="text-sm text-[var(--text-secondary)] p-6 text-center border border-dashed border-[var(--border-color)] rounded-xl">
                Seleziona un&apos;attività per vedere analisi e bozze.
              </p>
            ) : (
              <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-4">
                <div className="flex items-start gap-2">
                  <button onClick={() => setSelectedId(null)} className="md:hidden p-1 -ml-1" aria-label="Indietro">
                    <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] break-words">{selected.name}</h2>
                    <p className="text-xs text-[var(--text-secondary)]">Trovata con: {selected.search_query}</p>
                  </div>
                  <button onClick={remove} className="p-1.5 text-[var(--text-secondary)]" aria-label="Elimina">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 text-sm">
                  {selected.phone && (
                    <a href={`tel:${selected.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                      <Phone className="w-3.5 h-3.5" /> {selected.phone}
                    </a>
                  )}
                  {selected.website && (
                    <a href={selected.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                      <Globe className="w-3.5 h-3.5" /> Sito
                    </a>
                  )}
                  {selected.maps_url && (
                    <a href={selected.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                      <MapPin className="w-3.5 h-3.5" /> Maps
                    </a>
                  )}
                  {selected.instagram && (
                    <a href={selected.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                      <Instagram className="w-3.5 h-3.5" /> Instagram
                    </a>
                  )}
                  {selected.facebook && (
                    <a href={selected.facebook} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                      <Facebook className="w-3.5 h-3.5" /> Facebook
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selected.status}
                    onChange={(e) => save({ status: e.target.value })}
                    className={`${input} w-auto`}
                  >
                    {Object.entries(STATUS).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => analyzeOne(selected.id)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {busy === `analyze:${selected.id}` ? 'Analizzo il sito…' : selected.analyzed_at ? 'Rifai analisi' : 'Analizza'}
                  </button>
                </div>

                {selected.analysis && (
                  <div>
                    <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Analisi · punteggio {selected.score}/10
                    </p>
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{selected.analysis}</p>
                  </div>
                )}

                {selected.analyzed_at && (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">Email di primo contatto</p>
                      <input
                        value={draft.email || ''}
                        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                        onBlur={() => draft.email !== (selected.email || '') && save({ email: draft.email || '' })}
                        placeholder="Email non trovata sul sito: inseriscila a mano"
                        className={input}
                      />
                      <input
                        value={draft.email_subject || ''}
                        onChange={(e) => setDraft({ ...draft, email_subject: e.target.value })}
                        onBlur={() => draft.email_subject !== (selected.email_subject || '') && save({ email_subject: draft.email_subject || '' })}
                        placeholder="Oggetto"
                        className={input}
                      />
                      <textarea
                        value={draft.email_body || ''}
                        onChange={(e) => setDraft({ ...draft, email_body: e.target.value })}
                        onBlur={() => draft.email_body !== (selected.email_body || '') && save({ email_body: draft.email_body || '' })}
                        rows={9}
                        className={input}
                      />
                      {selected.contacted_at ? (
                        <p className="text-xs text-[var(--text-secondary)]">
                          Contattato il {new Date(selected.contacted_at).toLocaleDateString('it-IT')}: le risposte arrivano in
                          Messaggi.
                        </p>
                      ) : (
                        <button
                          onClick={sendEmail}
                          disabled={busy !== null || !draft.email || selected.status === 'do_not_contact'}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" /> {busy === 'send' ? 'Invio…' : 'Invia email'}
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">Messaggio Direct (invio manuale)</p>
                      <textarea
                        value={draft.dm_text || ''}
                        onChange={(e) => setDraft({ ...draft, dm_text: e.target.value })}
                        onBlur={() => draft.dm_text !== (selected.dm_text || '') && save({ dm_text: draft.dm_text || '' })}
                        rows={4}
                        className={input}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={copyDm}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                        >
                          <Copy className="w-4 h-4" /> Copia
                        </button>
                        {(selected.instagram || selected.facebook) && (
                          <a
                            href={selected.instagram || selected.facebook || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                          >
                            <ExternalLink className="w-4 h-4" /> Apri profilo
                          </a>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">Note</p>
                  <textarea
                    value={draft.notes || ''}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    onBlur={() => draft.notes !== (selected.notes || '') && save({ notes: draft.notes || '' })}
                    rows={2}
                    placeholder="Es. richiamare lunedì, parlato con il titolare…"
                    className={input}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
