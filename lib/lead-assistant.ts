import { supabaseAdmin } from '@/lib/supabase-admin'
import { budgetReached, callAIPaced, hasAIProvider, reportStatus, timeIsUp } from '@/lib/ai'
import { describeBudget, type Budget } from '@/lib/assistant-budget'
import {
  DAILY_EMAIL_LIMIT,
  firstEmailRules,
  LEAD_STATUSES,
  MAX_RESULTS,
  WHATSAPP_DISPLAY,
  analyzeLead,
  fetchPage,
  isPublicUrl,
  searchPlaces,
  type Lead,
} from '@/lib/leads'
import { prepareInboxReply, prepareOutreachReply, type SocialPlatform } from '@/lib/meta/agent'
import { pollGmail } from '@/lib/gmail-poll'
import { withCalls } from '@/lib/lead-calls'
import { SOURCE_CHAT, addContact } from '@/lib/contacts'
import { inspectWebsite, platformOf } from '@/lib/site-inspect'
import { fetchInstagramProfile } from '@/lib/meta/graph'
import { conversationKeyFor } from '@/lib/meta/identities'
import { listPushDevices, removePushDevice, sendPushToAdmins, updateDeviceInfo } from '@/lib/push'

// Agente della Ricerca clienti. Riceve una richiesta in linguaggio naturale e
// la porta a termine usando degli strumenti (cercare, analizzare, preparare
// email, riscrivere una bozza, aggiornare schede), anche in piu' passaggi.
// Le email vere partono solo dal browser, dopo conferma di Luca.

export const BATCH_LIMIT = 25
const MAX_STEPS = 10
const DEFAULT_FOLLOWUP_DAYS = 3

export type Draft = {
  leadId: string
  name: string
  email: string
  kind: 'first' | 'followup'
  subject: string
  body: string
  threadId?: string | null
}

export type AssistantResult = {
  reply: string
  drafts?: Draft[]
  removeDrafts?: string[]
  refresh?: boolean
  confirmSend?: boolean
  /** Schede da mostrare nella lista della pagina (es. "mostrami i contatti di poco fa"). */
  focus?: { label: string; ids: string[] }
  /** Tempo finito prima di completare: il browser rilancia da solo per continuare. */
  more?: boolean
  /** Messaggi social preparati: partono solo quando Luca preme Invia. */
  actions?: SocialAction[]
}

export type SocialAction = {
  kind: 'social_message'
  platform: 'instagram' | 'facebook'
  key: string
  name: string
  text: string
  /** Ultimo messaggio ricevuto da quella persona: Meta permette risposte libere entro 24 ore. */
  lastIncomingAt: string | null
}

type Turn = { role: 'user' | 'assistant'; text: string }

// ---------------------------------------------------------------------
// Strumenti
// ---------------------------------------------------------------------

function matchesFilter(lead: Lead, filter?: string) {
  const words = (filter || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  if (!words.length) return true
  const haystack = `${lead.name} ${lead.search_query || ''} ${lead.address || ''}`.toLowerCase()
  return words.every((w) => haystack.includes(w))
}

/** Lavora a gruppi; si ferma prima della scadenza della richiesta. fn riceve "n/totale" per i messaggi di stato. */
async function inBatches<T, R>(
  items: T[],
  fn: (item: T, position: string) => Promise<R | null>,
  size = 4
): Promise<{ out: R[]; unfinished: number }> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    if (timeIsUp() || budgetReached()) return { out, unfinished: items.length - i }
    const results = await Promise.all(
      items.slice(i, i + size).map((item, j) => fn(item, `${i + j + 1}/${items.length}`).catch(() => null))
    )
    for (const r of results) if (r) out.push(r)
  }
  return { out, unfinished: 0 }
}

async function loadLeads(ids?: string[]): Promise<Lead[]> {
  let query = supabaseAdmin.from('leads').select('*')
  if (ids?.length) query = query.in('id', ids)
  const { data } = await query.order('score', { ascending: false, nullsFirst: false }).limit(500)
  return withCalls((data || []) as Lead[])
}

function compact(lead: Lead) {
  return {
    id: lead.id,
    nome: lead.name,
    stato: lead.status,
    email: lead.email,
    punteggio: lead.score,
    analizzato: Boolean(lead.analyzed_at),
    contattato_il: lead.contacted_at?.slice(0, 10) ?? null,
    telefono: lead.phone || null,
    chiamato_il: lead.called_at?.slice(0, 10) ?? null,
    ricerca: lead.search_query,
    sito: lead.website || null,
    instagram: lead.instagram || null,
    facebook: lead.facebook || null,
  }
}

async function stats() {
  const leads = await loadLeads()
  const n = (fn: (l: Lead) => boolean) => leads.filter(fn).length
  return {
    totale: leads.length,
    da_contattare: n((l) => l.status === 'new'),
    da_contattare_con_email: n((l) => l.status === 'new' && Boolean(l.email)),
    da_contattare_non_analizzati: n((l) => l.status === 'new' && !l.analyzed_at),
    contattati_senza_risposta: n((l) => l.status === 'contacted'),
    segnati_non_ha_risposto: n((l) => l.status === 'no_answer'),
    hanno_risposto: n((l) => l.status === 'replied'),
    clienti: n((l) => l.status === 'client'),
    chiamati_al_telefono: n((l) => Boolean(l.called_at)),
    da_chiamare_con_telefono: n((l) => Boolean(l.phone) && !l.called_at && ['new', 'contacted', 'no_answer'].includes(l.status)),
    limite_primi_contatti_al_giorno: DAILY_EMAIL_LIMIT,
  }
}

async function generate(system: string, user: string): Promise<{ subject: string; body: string } | null> {
  const result = await callAIPaced([{ role: 'user', content: user }], system, {
    feature: 'email_clienti',
    temperature: 0.7,
    maxOutputTokens: 1200,
  })
  try {
    const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
    const data = json ? JSON.parse(json) : null
    if (!data?.body) return null
    return { subject: String(data.subject || '').slice(0, 150), body: String(data.body).slice(0, 4000) }
  } catch {
    return null
  }
}

function leadFacts(lead: Lead) {
  return [
    `Nome attività: ${lead.name}`,
    lead.address ? `Indirizzo: ${lead.address}` : '',
    lead.search_query ? `Trovata cercando: ${lead.search_query}` : '',
    lead.rating ? `Google: ${lead.rating}★ su ${lead.reviews_count ?? 0} recensioni` : '',
    lead.website ? `Sito: ${lead.website}` : 'Sito: nessuno',
    lead.instagram ? `Instagram: ${lead.instagram}` : '',
    lead.analysis ? `Analisi (punti deboli verificati):\n${lead.analysis}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function firstEmail(lead: Lead, extra?: string): Promise<Draft | null> {
  const rules = await firstEmailRules()
  const generated = await generate(
    `Sei l'assistente commerciale di Luca Corrao (Facevoice AI). Scrivi la PRIMA email di contatto a freddo, ${rules}
${extra ? `\nIndicazioni aggiuntive di Luca (valgono sullo stile, mai sull'onestà dei fatti): ${extra}` : ''}

Rispondi SOLO con JSON: {"subject": "...", "body": "..."}`,
    leadFacts(lead)
  )
  if (!generated) return null
  await supabaseAdmin.from('leads').update({ email_subject: generated.subject, email_body: generated.body }).eq('id', lead.id)
  return { leadId: lead.id, name: lead.name, email: lead.email!, kind: 'first', ...generated }
}

/** Prima email: analizza chi non e' ancora analizzato (cosi' si trova anche l'email), poi scrive. */
async function prepareFirst(args: { ids?: string[]; filter?: string; instructions?: string; limit?: number; skip: Set<string> }) {
  const limit = Math.min(BATCH_LIMIT, Math.max(1, args.limit || BATCH_LIMIT))
  // Chi ha gia' una bozza aperta non si rifa' (salvo richiesta esplicita per id).
  const pool = (await loadLeads(args.ids)).filter(
    (l) =>
      l.status === 'new' &&
      !l.contacted_at &&
      (args.ids?.length ? true : matchesFilter(l, args.filter) && !args.skip.has(l.id))
  )
  const targets = pool.slice(0, limit)
  const extra = args.instructions?.trim()
  const noEmail: string[] = []

  const { out: drafts, unfinished } = await inBatches(targets, async (lead, position) => {
    let ready = lead
    let justAnalyzed = false
    if (!ready.analyzed_at) {
      // Leggere il sito serve a trovare l'email e i dettagli veri per complimento e punto debole.
      reportStatus(`Leggo il sito di ${lead.name} (${position})…`)
      ready = await analyzeLead(lead)
      justAnalyzed = true
    }
    if (!ready.email) {
      noEmail.push(ready.name)
      return null
    }
    // L'analisi appena fatta ha gia' scritto la bozza con le regole attuali.
    if (justAnalyzed && !extra && ready.email_body) {
      return { leadId: ready.id, name: ready.name, email: ready.email, kind: 'first' as const, subject: ready.email_subject || '', body: ready.email_body }
    }
    reportStatus(`Scrivo l’email per ${ready.name} (${position})…`)
    return firstEmail(ready, extra)
  })

  return {
    drafts,
    unfinished: unfinished + Math.max(0, pool.length - targets.length),
    result: {
      bozze_preparate: drafts.length,
      senza_email_trovata: noEmail,
      rimasti_da_fare: unfinished + Math.max(0, pool.length - targets.length),
    },
  }
}

const FOLLOWUP_RULES = `Scrivi una breve email di FOLLOW-UP, come la scriverebbe Luca a mano, che risponde nello stesso thread alla prima email (te la passo sotto). Regole:
- Dai del TU, italiano parlato di tutti i giorni, parole semplici, frasi corte; mai insistente, mai colpevolizzante ("non hai risposto…"), mai frasi da marketing.
- 30-60 parole (firma esclusa), paragrafi di 1-2 frasi, niente elenchi, niente prezzi.
- Apri con un saluto leggero e un richiamo naturale alla mail precedente (es. "Ciao! Ti riscrivo al volo perché immagino che tra mille cose la mia mail ti sia sfuggita").
- Aggiungi UN elemento nuovo e utile legato al loro punto debole (un'idea concreta, un esempio), non ripetere la prima email.
- Chiudi portando alla chiamata su WhatsApp, es. "Se ti va, ci sentiamo dieci minuti su WhatsApp: scrivimi al ${WHATSAPP_DISPLAY} e ti chiamo io."
- Firma: "A presto,\\nLuca Corrao\\nFacevoice AI · www.facevoice.ai\\nWhatsApp ${WHATSAPP_DISPLAY}"
- Niente P.S. e nessuna frase tipo "se non ti interessa…".
- Oggetto: lo stesso della prima email preceduto da "Re: ".`

async function prepareFollowups(args: { ids?: string[]; filter?: string; instructions?: string; days?: number; limit?: number; skip: Set<string> }) {
  const days = Math.max(0, args.days ?? DEFAULT_FOLLOWUP_DAYS)
  const before = Date.now() - days * 86_400_000
  const limit = Math.min(BATCH_LIMIT, Math.max(1, args.limit || BATCH_LIMIT))
  const pool = (await loadLeads(args.ids)).filter(
    (l) =>
      (l.status === 'contacted' || l.status === 'no_answer') &&
      l.email &&
      l.contacted_at &&
      new Date(l.contacted_at).getTime() <= before &&
      (args.ids?.length ? true : matchesFilter(l, args.filter) && !args.skip.has(l.id))
  )
  const extra = args.instructions?.trim()

  const { out: drafts, unfinished } = await inBatches(pool.slice(0, limit), async (lead, position) => {
    reportStatus(`Scrivo il follow-up per ${lead.name} (${position})…`)
    const email = lead.email!.toLowerCase()
    const { data: last } = await supabaseAdmin
      .from('social_messages')
      .select('body, channel_account_id')
      .eq('platform', 'email')
      .eq('contact_id', email)
      .eq('direction', 'out')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const generated = await generate(
      `Sei l'assistente commerciale di Luca Corrao (Facevoice AI). ${FOLLOWUP_RULES}
${extra ? `\nIndicazioni aggiuntive di Luca: ${extra}` : ''}

Rispondi SOLO con JSON: {"subject": "...", "body": "..."}`,
      `${leadFacts(lead)}\n\nPrima email inviata:\nOggetto: ${lead.email_subject || ''}\n${lead.email_body || last?.body || ''}`
    )
    if (!generated) return null
    const subject = generated.subject || `Re: ${lead.email_subject || lead.name}`
    return {
      leadId: lead.id,
      name: lead.name,
      email,
      kind: 'followup' as const,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      body: generated.body,
      threadId: last?.channel_account_id ?? null,
    }
  })

  const left = unfinished + Math.max(0, pool.length - limit)
  return {
    drafts,
    unfinished: left,
    result: { bozze_preparate: drafts.length, giorni_minimi: days, in_attesa_totali: pool.length, rimasti_da_fare: left },
  }
}

async function reviseDraft(draft: Draft, instructions: string): Promise<Draft | null> {
  const lead = (await loadLeads([draft.leadId]))[0]
  const generated = await generate(
    `Sei l'assistente commerciale di Luca Corrao (Facevoice AI). Riscrivi questa email seguendo ESATTAMENTE le indicazioni di Luca, mantenendo tutto il resto (stile amichevole, del tu, firma, chiusura sulla chiamata WhatsApp, niente P.S.) salvo che Luca chieda diversamente. Non inventare fatti sull'attività.

Rispondi SOLO con JSON: {"subject": "...", "body": "..."}`,
    `${lead ? leadFacts(lead) : `Attività: ${draft.name}`}\n\nEmail attuale:\nOggetto: ${draft.subject}\n${draft.body}\n\nIndicazioni di Luca: ${instructions}`
  )
  if (!generated) return null
  if (draft.kind === 'first') {
    await supabaseAdmin.from('leads').update({ email_subject: generated.subject, email_body: generated.body }).eq('id', draft.leadId)
  }
  return { ...draft, subject: generated.subject || draft.subject, body: generated.body }
}

/** Conversazione email con un contatto (prima email, risposte, bozze in attesa). */
async function readConversation(lead: Lead) {
  if (!lead.email) return { errore: 'la scheda non ha un’email' }
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('direction, body, status, created_at')
    .eq('platform', 'email')
    .ilike('contact_id', lead.email)
    .order('created_at', { ascending: false })
    .limit(10)
  const messages = (data || []).reverse()
  if (!messages.length) return { nome: lead.name, messaggi: [], nota: 'nessun messaggio registrato' }
  return {
    nome: lead.name,
    analisi: lead.analysis,
    messaggi: messages.map((m) => ({
      da: m.direction === 'in' ? 'cliente' : m.status === 'pending' ? 'bozza in attesa di Luca' : 'Luca',
      data: m.created_at,
      testo: String(m.body || '').slice(0, 2000),
    })),
  }
}

/**
 * Situazione aggiornata di chi ci ha risposto: letta dal database a ogni richiesta,
 * cosi' l'assistente vede sempre le ultime risposte e le controrisposte (in attesa o gia' inviate).
 */
async function repliesOverview() {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, email')
    .in('status', ['replied', 'client'])
    .not('email', 'is', null)
    .limit(40)
  if (!leads?.length) return []
  const emails = leads.map((l) => String(l.email).toLowerCase())
  const { data: messages } = await supabaseAdmin
    .from('social_messages')
    .select('contact_id, direction, status, body, created_at')
    .eq('platform', 'email')
    .in('contact_id', emails)
    .order('created_at', { ascending: false })
    .limit(400)

  return leads.map((lead) => {
    const email = String(lead.email).toLowerCase()
    const thread = (messages || []).filter((m) => m.contact_id === email)
    const lastIn = thread.find((m) => m.direction === 'in')
    const pending = thread.find((m) => m.direction === 'out' && m.status === 'pending')
    const sentAfter = lastIn && thread.find((m) => m.direction === 'out' && m.status === 'sent' && m.created_at > lastIn.created_at)
    return {
      leadId: lead.id,
      nome: lead.name,
      ultima_risposta_il: lastIn?.created_at ?? null,
      ultima_risposta: lastIn ? String(lastIn.body || '').slice(0, 300) : null,
      controrisposta: pending ? 'in attesa di approvazione in Messaggi' : sentAfter ? 'già inviata' : lastIn ? 'da preparare' : 'nessuna risposta registrata',
      bozza_attuale: pending ? String(pending.body || '').slice(0, 400) : undefined,
    }
  })
}

/** Prepara (o rifa', tenendo conto della versione attuale) la controrisposta per un contatto. */
async function replyFor(
  lead: Lead,
  instructions?: string,
  options: { force?: boolean; redoPending?: boolean } = {}
): Promise<{ ok: boolean; reason?: string; text?: string }> {
  const email = lead.email!.toLowerCase()
  const extra = instructions?.trim()
  const { data: thread } = await supabaseAdmin
    .from('social_messages')
    .select('direction, status, body, created_at')
    .eq('platform', 'email')
    .eq('contact_id', email)
    .order('created_at', { ascending: false })
    .limit(30)
  const lastIn = (thread || []).find((m) => m.direction === 'in')
  const pending = (thread || []).find((m) => m.direction === 'out' && m.status === 'pending')
  const sentAfter =
    lastIn && (thread || []).find((m) => m.direction === 'out' && m.status === 'sent' && m.created_at > lastIn.created_at)

  // Alla sua ultima risposta abbiamo gia' risposto: niente seconda controrisposta, salvo richiesta esplicita.
  if (sentAfter && !options.force) {
    return {
      ok: false,
      reason: `controrisposta già inviata il ${new Date(sentAfter.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}: non ne preparo un'altra finché non risponde di nuovo (o se Luca lo chiede esplicitamente)`,
    }
  }
  // Una controrisposta e' gia' pronta in Messaggi: si tiene quella, salvo modifiche o richiesta di rifarla.
  if (pending && !extra && !options.force && !options.redoPending) {
    return { ok: false, reason: 'c’è già una controrisposta in attesa di approvazione in Messaggi', text: String(pending.body || '') }
  }
  const notes = [
    lead.notes,
    extra ? `Indicazioni di Luca per questa risposta: ${extra}` : '',
    extra && pending?.body ? `Versione attuale della controrisposta, da modificare secondo le indicazioni:\n${pending.body}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return prepareOutreachReply(email, {
    leadId: lead.id,
    name: lead.name,
    analysis: lead.analysis,
    notes: notes || null,
    firstEmail: lead.email_body ? `Oggetto: ${lead.email_subject || ''}\n\n${lead.email_body}` : null,
  })
}

const ORIGIN_LABEL: Record<string, string> = {
  outreach: 'email della Ricerca clienti',
  ai_auto: 'risposta automatica AI',
  ai_approved: 'risposta AI approvata',
  ai_edited: 'risposta AI modificata e approvata',
  manual: 'scritta a mano',
}

/**
 * Attività di un periodo: messaggi inviati e ricevuti per canale e tipo, con
 * l'elenco dei più recenti (ora italiana). Risponde a "quante email sono partite
 * nell'ultima ora", "chi ci ha scritto oggi", ecc.
 */
async function activityReport(args: { hours?: number; from?: string; to?: string; platform?: string }) {
  const until = args.to ? new Date(args.to) : new Date()
  const since = args.from ? new Date(args.from) : new Date(until.getTime() - Math.max(0.05, args.hours ?? 1) * 3600_000)
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) return { errore: 'date non valide' }
  const platform = args.platform && args.platform !== 'all' ? args.platform : null

  const query = (fields: string) => {
    let q = supabaseAdmin
      .from('social_messages')
      .select(fields)
      .gte('created_at', since.toISOString())
      .lte('created_at', until.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)
    if (platform) q = q.eq('platform', platform)
    return q
  }
  let { data, error } = await query('platform, direction, status, origin, kind, contact_name, contact_id, body, created_at')
  // Senza la colonna origin (migrazione non lanciata) si lavora lo stesso.
  if (error) ({ data, error } = await query('platform, direction, status, kind, contact_name, contact_id, body, created_at'))
  if (error) return { errore: error.message }
  const rows = (data || []) as unknown as {
    platform: string; direction: string; status: string | null; origin?: string | null; kind: string
    contact_name: string | null; contact_id: string; body: string | null; created_at: string
  }[]

  const time = (iso: string) =>
    new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const count = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter(fn).length
  const byPlatform: Record<string, { inviati: number; ricevuti: number; falliti: number; in_attesa: number }> = {}
  const byOrigin: Record<string, number> = {}
  for (const r of rows) {
    const p = (byPlatform[r.platform] ||= { inviati: 0, ricevuti: 0, falliti: 0, in_attesa: 0 })
    if (r.direction === 'in') p.ricevuti++
    else if (r.status === 'sent') {
      p.inviati++
      const label = ORIGIN_LABEL[r.origin || ''] || 'altro'
      byOrigin[label] = (byOrigin[label] || 0) + 1
    } else if (r.status === 'failed') p.falliti++
    else if (r.status === 'pending') p.in_attesa++
  }

  return {
    periodo: `dal ${time(since.toISOString())} al ${time(until.toISOString())} (ora italiana)`,
    inviati: count((r) => r.direction === 'out' && r.status === 'sent'),
    ricevuti: count((r) => r.direction === 'in'),
    invii_falliti: count((r) => r.direction === 'out' && r.status === 'failed'),
    bozze_in_attesa: count((r) => r.direction === 'out' && r.status === 'pending'),
    per_canale: byPlatform,
    inviati_per_tipo: byOrigin,
    ultimi: rows.slice(0, 30).map((r) => ({
      ora: time(r.created_at),
      canale: r.platform,
      verso: r.direction === 'in' ? 'ricevuto da' : r.status === 'sent' ? 'inviato a' : `${r.status || 'non inviato'} per`,
      contatto: r.contact_name || r.contact_id,
      testo: String(r.body || '').replace(/\s+/g, ' ').slice(0, 90),
    })),
  }
}

/** Conversazioni Instagram/Facebook della casella (chi ci ha scritto). */
const INBOX_PLATFORMS = ['email', 'instagram', 'facebook', 'whatsapp', 'web']
/** Per cercare "Galdieri Rent" anche in "Galdierirent" o "galdieri-rent.it": minuscole, niente spazi e segni. */
const squash = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9@]+/g, '')

/**
 * Conversazioni della casella Messaggi (tutti i canali), dalla piu' recente.
 * Il filtro cerca in nome, indirizzo/id e testo dei messaggi (anche l'oggetto delle email).
 */
async function listConversations(platform: string | undefined, filter: string | undefined, limit: number) {
  const platforms = platform && INBOX_PLATFORMS.includes(platform) ? [platform] : INBOX_PLATFORMS
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('platform, contact_id, contact_name, body, direction, status, created_at')
    .in('platform', platforms)
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1500)
  type Conv = { platform: string; contactId: string; nome: string | null; ultimo_messaggio: string; ultimo_da: string; data: string; hay: string }
  const convs = new Map<string, Conv>()
  for (const m of data || []) {
    if (m.status === 'rejected') continue
    const id = `${m.platform}:${m.contact_id}`
    const body = String(m.body || '')
    const conv = convs.get(id)
    if (!conv) {
      convs.set(id, {
        platform: m.platform,
        contactId: m.contact_id,
        nome: m.contact_name,
        ultimo_messaggio: body.slice(0, 200),
        ultimo_da: m.direction === 'in' ? 'contatto' : m.status === 'pending' ? 'bozza in attesa' : 'noi',
        data: m.created_at,
        hay: squash(`${m.contact_name || ''} ${m.contact_id} ${body.slice(0, 600)}`),
      })
    } else {
      if (!conv.nome && m.contact_name) conv.nome = m.contact_name
      if (conv.hay.length < 6000) conv.hay += squash(`${m.contact_name || ''} ${body.slice(0, 600)}`)
    }
  }
  const words = (filter || '').split(/\s+/).map(squash).filter(Boolean)
  const whole = squash(filter || '')
  return [...convs.values()]
    .filter((c) => !words.length || c.hay.includes(whole) || words.every((w) => c.hay.includes(w)))
    .slice(0, limit)
    .map(({ hay: _hay, ...c }) => c)
}

/** Ultimi messaggi di una conversazione qualsiasi (letti, inviati e bozze in attesa). */
async function readThread(platform: string, contactId: string) {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('direction, kind, body, status, contact_name, created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(20)
  const messages = (data || []).filter((m) => m.status !== 'rejected').reverse()
  if (!messages.length) return { errore: 'conversazione non trovata: usa list_conversations per platform e contactId' }
  return {
    nome: messages.find((m) => m.contact_name)?.contact_name || contactId,
    canale: platform,
    messaggi: messages.map((m) => ({
      da: m.direction === 'in' ? 'contatto' : m.status === 'pending' ? 'bozza in attesa di Luca' : 'noi',
      tipo: m.kind === 'comment' ? 'commento pubblico' : 'messaggio',
      data: m.created_at,
      testo: String(m.body || '').slice(0, 2500),
    })),
  }
}

// ---------------------------------------------------------------------
// Piattaforma dei siti (WordPress, Wix…): solo la home, risultato in cache
// ---------------------------------------------------------------------

const PLATFORM_KEY = 'site_platform:'
const PLATFORM_TTL = 7 * 86_400_000

async function sitePlatforms(leads: Lead[]): Promise<{ results: { lead: Lead; platform: string | null; reachable: boolean }[]; unfinished: number }> {
  const keys = leads.map((l) => `${PLATFORM_KEY}${l.id}`)
  const { data } = keys.length ? await supabaseAdmin.from('app_settings').select('key, value').in('key', keys) : { data: [] }
  const cached = new Map<string, { platform: string | null; reachable: boolean; checkedAt: number }>()
  for (const row of data || []) {
    try {
      cached.set(row.key.slice(PLATFORM_KEY.length), JSON.parse(row.value))
    } catch {}
  }
  const { out, unfinished } = await inBatches(leads, async (lead, position) => {
    const hit = cached.get(lead.id)
    if (hit && Date.now() - hit.checkedAt < PLATFORM_TTL) return { lead, platform: hit.platform, reachable: hit.reachable }
    reportStatus(`Controllo il sito di ${lead.name} (${position})…`)
    let html = ''
    try {
      const url = new URL(/^https?:\/\//i.test(lead.website!) ? lead.website! : `https://${lead.website}`)
      if (isPublicUrl(url)) html = await fetchPage(url.href)
    } catch {}
    const result = { platform: html ? platformOf(html) : null, reachable: Boolean(html), checkedAt: Date.now() }
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: `${PLATFORM_KEY}${lead.id}`, value: JSON.stringify(result), updated_at: new Date().toISOString() })
    return { lead, platform: result.platform, reachable: result.reachable }
  }, 6)
  return { results: out, unfinished }
}

// ---------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------

const AGENT_PROMPT = `Sei l'assistente operativo di Luca nella pagina "Ricerca clienti" di Facevoice AI. Luca ti chiede cose in linguaggio naturale e tu le porti a termine usando gli strumenti, anche in più passaggi. Sii proattivo: se per fare una cosa serve prima un'altra (es. analizzare i siti per trovare le email), falla senza chiedere.
Se nella richiesta c'è "[Contenuto delle immagini allegate da Luca]", è la trascrizione degli screenshot o delle foto che Luca ti ha mandato: usala come se la vedessi (nomi, email, oggetti, importi, conversazioni) e per cercare le persone con list_conversations o list_leads.

A ogni passo rispondi SOLO con un JSON, in uno di questi due formati:
{"tool": "nome_strumento", "args": {...}}
{"reply": "risposta finale breve per Luca, in italiano", "confirm_send": false}

Strumenti:
- "stats": {} → numeri della lista.
- "list_leads": {"status": "new|contacted|no_answer|replied|client|discarded|do_not_contact|all" (no_answer = "Non ha risposto", segnato a mano da Luca), "filter": "testo opzionale", "only_with_email": false, "recent_minutes": 120, "called": true|false, "only_with_phone": false, "limit": 30, "label": "titolo breve"} → elenco schede (id, nome, stato, email, telefono, chiamato_il...). "called": true = già chiamati al telefono da Luca (casella "Chiamato"), false = non ancora chiamati. Le schede trovate vengono anche MOSTRATE a Luca nella lista della pagina: usalo quando chiede di vedere/mostrare contatti (es. "mostrami quelli generati poco fa" → recent_minutes 180, label "Generati poco fa").
- "search_places": {"query": "ristoranti Catania", "max": 20} → cerca su Google Maps e aggiunge alla lista (max 20, 40 o 60).
- "analyze": {"ids": [...] oppure omesso, "limit": 25} → legge i siti delle schede nuove non analizzate: trova email e social, dà il punteggio.
- "prepare_first_emails": {"ids": [...] opzionale, "filter": "testo opzionale", "instructions": "indicazioni di Luca", "limit": 25} → prepara le PRIME email per chi non è ancora stato contattato (analizza da solo chi non è analizzato). Le bozze compaiono a Luca per il controllo.
- "prepare_followups": {"ids": [...] opzionale, "filter": "", "days": 3, "instructions": "", "limit": 25} → prepara follow-up per chi è stato contattato e non ha risposto (days = giorni minimi dal primo contatto; usa 0 se Luca dice "a tutti" o "anche di oggi").
- "revise_draft": {"leadId": "...", "instructions": "cosa cambiare"} → riscrive una bozza già preparata (vedi l'elenco delle bozze aperte). Per riscriverne più di una, chiamalo più volte o usa "revise_all".
- "revise_all": {"instructions": "cosa cambiare"} → riscrive tutte le bozze aperte con la stessa indicazione.
- "remove_drafts": {"leadIds": [...]} → toglie bozze dalla lista.
- "update_leads": {"ids": [...], "status": "...", "notes": "...", "email": "..."} → aggiorna schede (stato, note, email corretta).
- "read_conversation": {"leadId": "..."} → legge la conversazione email con quel contatto (prima email, sue risposte, bozze in attesa). Usalo quando Luca chiede cosa ha risposto qualcuno o quali leve usare: poi rispondi tu con un'analisi breve (cosa chiede, tono, leve concrete).
- "prepare_reply": {"leadId": "...", "instructions": "indicazioni di Luca, opzionali", "force": false} → prepara la controrisposta a chi ci ha risposto e la mette da approvare in Messaggi (non parte da sola), al posto di quella vecchia. Se Luca chiede una modifica a una controrisposta già pronta, usalo con le sue indicazioni: si parte dalla versione attuale. Nella risposta finale riassumi in breve cosa dice e ricorda che è da approvare in Messaggi.
- "prepare_replies": {"instructions": "opzionali", "redo": false} → prepara le controrisposte per TUTTI quelli che hanno risposto e sono "da preparare" (con redo=true rifà anche quelle in attesa). Non tocca mai quelle "già inviata".
Regola sulle controrisposte: se la controrisposta è "già inviata" non se ne prepara un'altra (aspettiamo che il cliente risponda di nuovo). Usa "force": true SOLO se Luca chiede esplicitamente di scrivergli di nuovo / una seconda email nonostante l'invio. Se c'è già una controrisposta "in attesa", non rifarla da zero: mostrala o modificala con le indicazioni di Luca.

La sezione "Risposte ricevute" qui sotto è aggiornata a questo istante (la casella è appena stata controllata): fidati di questa e non della conversazione precedente quando le cose sono cambiate.

Strumenti per domande sull'attività (rispondi con numeri precisi, senza fare altro):
- "activity_report": {"hours": 1} oppure {"from": "ISO", "to": "ISO"}, "platform": "email|instagram|facebook|whatsapp|web|all" → quanti messaggi sono stati inviati e ricevuti nel periodo, per canale e per tipo (email della Ricerca clienti, risposte automatiche, approvate, scritte a mano), invii falliti, bozze in attesa, e gli ultimi 30 con ora, contatto e inizio del testo. Usalo per domande tipo "quante email sono partite nell'ultima ora", "chi ci ha scritto oggi" (calcola le ore da mezzanotte con la data e ora qui sotto), "quanti messaggi Instagram ieri".
- Per numeri sulla lista clienti usa "stats" o "list_leads".
Se Luca dice "senza fare nulla" / "senza compiere azioni", usa solo strumenti di lettura (stats, list_leads, activity_report, read_conversation, list_conversations, read_thread, inspect_website, instagram_profile, list_push_devices).

Strumenti di ricerca e social:
- "inspect_website": {"leadId": "..."} oppure {"url": "https://..."} → legge il sito (fino a 10 pagine): elenco pagine con titolo e contenuto, piattaforma (WordPress, Wix…), anno più recente citato e copyright (per capire se è aggiornato), funzioni presenti (prenotazioni, shop, blog, newsletter, WhatsApp, Analytics, Pixel), link social. Poi spiega tu a Luca, in parole semplici, che pagine ci sono, di cosa parlano, se il sito sembra usato attivamente e cosa manca.
- "instagram_profile": {"username": "nomeprofilo"} oppure {"leadId": "..."} → profilo Instagram pubblico (solo account business/creator): follower, seguiti, numero di post, bio, sito, ultimi 6 post con data, like e commenti (per capire se pubblicano e quanto spesso).
- "instagram_profiles": {"ids": [...] opzionale, "filter": "", "limit": 15} → lo stesso per più schede che hanno un Instagram (per domande tipo "quali hanno Instagram e quanti follower").
- "list_conversations": {"platform": "email|instagram|facebook|whatsapp|web|all", "filter": "parole da cercare, opzionale", "limit": 20} → conversazioni della casella Messaggi su TUTTI i canali, email comprese (platform, contactId, nome, ultimo messaggio, data). Il filtro cerca in nome, indirizzo e testo dei messaggi (anche l'oggetto delle email) e ignora spazi e maiuscole: "Galdieri Rent" trova anche "Galdierirent". Se Luca nomina una persona o un'azienda che non è nella lista Clienti, cercala QUI prima di dire che non esiste.
- "read_thread": {"platform": "...", "contactId": "..."} → legge gli ultimi messaggi di una conversazione qualsiasi di Messaggi (ricevuti, inviati, bozze).
- "prepare_inbox_reply": {"platform": "...", "contactId": "...", "instructions": "cosa vuole Luca", "to": "email, solo se Luca indica un indirizzo diverso"} → prepara la risposta a una conversazione qualsiasi di Messaggi (email, Instagram, Messenger, WhatsApp, chat del sito) seguendo le indicazioni di Luca e la mette da approvare in Messaggi (non parte da sola). Per chi è nella lista Clienti e ha risposto alle nostre email usa invece prepare_reply.
REGOLA: se Luca ti chiede di rispondere a qualcuno, non dirgli mai "non lo trovo" o "dammi l'email" prima di aver cercato con list_conversations (anche solo con una parte del nome o dell'azienda). Quando lo trovi, prepara SEMPRE la risposta con prepare_inbox_reply, anche se l'ultima email è una ricevuta o arriva da un indirizzo automatico (no-reply): lo strumento trova da solo l'indirizzo vero dell'azienda. Poi dici a Luca a chi va (destinatario) e riporti l'avviso se c'è.
- "send_social_message": {"platform": "instagram|facebook", "contactId": "...", "text": "..."} → PREPARA un messaggio Instagram/Facebook a una persona della casella (contactId da list_conversations). Non parte da solo: a Luca compare il pulsante Invia. Regola di Meta: si può scrivere solo a chi ci ha già scritto, e liberamente entro 24 ore dal suo ultimo messaggio; a nuovi profili mai contattati non si può scrivere in privato tramite API (suggerisci di commentare un loro post o scrivere dal telefono).

Piattaforma dei siti:
- "site_platforms": {"platform": "WordPress", "ids": [...] opzionale, "filter": "testo opzionale", "limit": 60} → controlla con cosa è fatto il sito di ogni scheda con un sito (WordPress, Wix, Shopify, Squarespace, Webflow, Jimdo, su misura) e restituisce quelle con la piattaforma chiesta (senza "platform": tutte, con la piattaforma di ciascuna). Le schede trovate vengono MOSTRATE a Luca nella lista. Usalo per richieste tipo "quali contatti hanno un sito WordPress" o prima di scrivere a chi usa una certa piattaforma (es. un avviso di sicurezza per WordPress/PHP): poi usa prepare_first_emails con quegli "ids" per chi non è ancora stato contattato e prepare_followups con quegli "ids" e "days": 0 per chi è già stato contattato, passando il testo o le indicazioni di Luca in "instructions".

Rubrica contatti (pagina Contatti, dove finiscono anche tutte le schede delle ricerche):
- "add_contact": {"name": "...", "phone": "...", "email": "...", "website": "...", "address": "...", "instagram": "...", "facebook": "...", "notes": "..."} → aggiunge un contatto alla rubrica. Usalo quando Luca detta o scrive i dati di un cliente o di una persona (anche a voce, es. "aggiungi Mario Rossi della pizzeria Da Mario, numero 333 1234567, vuole un sito"). Solo "name" è obbligatorio; metti in "notes" quello che non rientra negli altri campi (chi è, cosa vuole, quando richiamarlo). Non inventare dati: se un campo non è stato detto, omettilo. Se il contatto esiste già (stessa email, telefono o nome) vengono completati solo i campi mancanti. Per più contatti chiamalo più volte. Nella risposta conferma in breve cosa hai salvato.
- Per cercare o elencare contatti già salvati usa "list_leads" (con "filter" sul nome).

Strumenti per le notifiche push (i dispositivi su cui arrivano gli avvisi di Messaggi, richieste di accesso, ecc.):
- "list_push_devices": {} → tutti i dispositivi che ricevono le notifiche: id, nome, browser e sistema (es. "Chrome su Windows", "Safari su iPhone"), se è l'app installata, email dell'account, data di registrazione, ultima apertura di Messaggi, ultima notifica consegnata, ultimo errore. Se "knownDetails" è false il dispositivo è stato registrato prima che salvassimo il browser: il tipo è dedotto dal servizio push; si completa da solo quando Luca apre Messaggi da quel dispositivo. Usalo per domande tipo "quali dispositivi ricevono le notifiche".
- "test_push": {"deviceIds": [...] opzionale, "text": "testo opzionale"} → invia una notifica di prova a quei dispositivi (o a tutti) e dice quanti l'hanno ricevuta. Utile per capire quale dispositivo è quale.
- "rename_push_device": {"deviceId": "...", "name": "iPhone di Luca"} → dà un nome a un dispositivo.
- "remove_push_device": {"deviceIds": [...]} → smette di inviare notifiche a quei dispositivi. Usalo SOLO se Luca chiede esplicitamente di togliere/disattivare un dispositivo.
Nella risposta descrivi i dispositivi in modo semplice (nome, tipo, da quando, ultima notifica ricevuta), con date e ore in italiano; non mostrare gli id se non servono.

Se Luca fa una domanda generale (consigli, idee, strategia, testi), rispondi direttamente senza strumenti.

Invio: tu NON invii email. Se Luca chiede di inviare/mandare le bozze aperte, rispondi con {"reply": "...", "confirm_send": true}: comparirà a Luca la conferma di invio.

Scrivi le risposte finali in testo semplice: niente markdown, niente asterischi. Regole: non inventare id (usa list_leads), al massimo ${MAX_STEPS} passi, risposta finale breve con cosa hai fatto e cosa resta (es. contatti senza email: suggerisci di scrivergli sui social o chiamarli).`

type ToolCall = { tool?: string; args?: Record<string, unknown>; reply?: string; confirm_send?: boolean }

function parseStep(raw: string): ToolCall | null {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    return json ? (JSON.parse(json) as ToolCall) : null
  } catch {
    return null
  }
}

const asIds = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined)
const asText = (value: unknown) => (typeof value === 'string' ? value : undefined)
const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Avanzamento tra un giro e l'altro: passi gia' fatti e avviso a ogni passo concluso. */
export type Progress = { done?: string[]; onStep?: (line: string) => void }

/** Riga breve che descrive un passo concluso (strumento, argomenti, esito). */
function stepLine(tool: string, args: Record<string, unknown>, result: unknown) {
  const a = JSON.stringify(args)
  const r = JSON.stringify(result) ?? ''
  return `${tool} ${a === '{}' ? '' : a.slice(0, 200)} → ${r.length > 260 ? `${r.slice(0, 260)}…` : r}`
}

export async function runAssistant(
  message: string,
  history: Turn[],
  openDrafts: Draft[],
  budget?: Budget | null,
  progress?: Progress
): Promise<AssistantResult> {
  if (!hasAIProvider()) return { reply: 'Manca una chiave AI (Gemini o Claude): l’assistente non può lavorare.' }

  const drafts = new Map(openDrafts.map((d) => [d.leadId, d]))
  const changed = new Map<string, Draft>()
  const removed = new Set<string>()
  let refresh = false
  let more = false
  let focus: AssistantResult['focus']
  const actions: SocialAction[] = []

  // Prima di tutto la casella: le risposte arrivate in questo momento devono essere gia' note.
  reportStatus('Controllo la casella per nuove risposte…')
  await pollGmail().catch((error) => console.error('lead assistant poll:', error))
  const replies = await repliesOverview().catch(() => [])

  const context = [
    `Data e ora attuali: ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (ora italiana; ISO ${new Date().toISOString()})`,
    `Riepilogo: ${JSON.stringify(await stats())}`,
    replies.length ? `Risposte ricevute (aggiornate ora):\n${JSON.stringify(replies)}` : 'Risposte ricevute: nessuna.',
    drafts.size
      ? `Bozze aperte (non ancora inviate):\n${[...drafts.values()]
          .map((d) => `- leadId ${d.leadId} · ${d.name} · ${d.kind === 'first' ? 'primo contatto' : 'follow-up'} · oggetto "${d.subject}"\n  ${d.body.slice(0, 300).replace(/\n/g, ' ')}`)
          .join('\n')}`
      : 'Nessuna bozza aperta.',
    history.length ? `Conversazione recente:\n${history.slice(-6).map((t) => `${t.role === 'user' ? 'Luca' : 'Assistente'}: ${t.text}`).join('\n')}` : '',
    progress?.done?.length
      ? `PASSI GIÀ FATTI per questa richiesta nei giri precedenti (i risultati sono già salvati nel database: NON rifarli, riparti da quello che manca; per rivedere le schede trovate usa list_leads con recent_minutes):\n${progress.done.map((l) => `- ${l}`).join('\n')}`
      : '',
    budget
      ? `LIMITE DI SPESA per questa richiesta: ${describeBudget(budget)} in tutto. Ogni passo costa: fai pochi passi, ricerche e analisi su numeri piccoli (es. 20 risultati, limit 10), e punta al risultato più utile. Quando il limite sta per finire ti fermo io e mi dai il riepilogo.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const transcript: { role: string; content: string }[] = [{ role: 'user', content: `${context}\n\nRichiesta di Luca: ${message}` }]

  // Le parole di Luca arrivano sempre a chi scrive le email: tono e indicazioni
  // non devono perdersi nel riassunto dell'agente.
  const withLuca = (instructions?: string) =>
    [instructions?.trim(), `Richiesta di Luca, da rispettare per tono e contenuto: ${message}`].filter(Boolean).join('\n')

  for (let step = 0; step < MAX_STEPS; step++) {
    if (budget && step > 0 && budgetReached()) {
      // Limite di spesa: un'ultima risposta breve con quello che e' stato fatto, niente altri strumenti.
      reportStatus('Limite di spesa raggiunto: preparo il riepilogo…')
      transcript.push({
        role: 'user',
        content: `LIMITE DI SPESA RAGGIUNTO (${describeBudget(budget)}). Non usare altri strumenti: rispondi ora SOLO con {"reply": "..."} dicendo in breve cosa hai fatto, cosa hai trovato e cosa resta da fare se Luca vuole continuare.`,
      })
      // Riepilogo economico: la conversazione va all'AI accorciata.
      const short = transcript.map((m, i) => (i === 0 ? { ...m, content: m.content.slice(-2500) } : { ...m, content: m.content.slice(0, 600) }))
      const last = await callAIPaced(short, AGENT_PROMPT, { feature: 'assistente_clienti', temperature: 0.2, maxOutputTokens: 600 })
      const summary = parseStep(last.message || '')
      return finish(`${summary?.reply || 'Mi sono fermato al limite di spesa che mi hai dato.'}\n\n(Mi sono fermato al limite di spesa: ${describeBudget(budget)}.)`)
    }
    if (timeIsUp()) {
      more = true
      return finish(changed.size ? `Ho preparato ${changed.size} bozze finora, continuo con il resto…` : 'Sto ancora lavorando: continuo con il resto…')
    }
    reportStatus(step === 0 ? 'Leggo la richiesta e decido da dove partire…' : 'Valuto il risultato e decido il passo successivo…')
    const response = await callAIPaced(transcript, AGENT_PROMPT, {
      feature: 'assistente_clienti',
      temperature: 0.2,
      maxOutputTokens: 2000,
    })
    const raw = response.message || ''
    const call = parseStep(raw)
    if (!call) return finish(raw.trim() || 'Non ho capito, puoi riformulare?')
    if (call.reply !== undefined && !call.tool) return finish(call.reply, Boolean(call.confirm_send))

    const args = call.args || {}
    let result: unknown
    try {
      switch (call.tool) {
        case 'stats':
          result = await stats()
          break
        case 'list_leads': {
          const status = asText(args.status) || 'all'
          const limit = Math.min(60, asNumber(args.limit) || 30)
          const recentMinutes = asNumber(args.recent_minutes)
          const since = recentMinutes ? Date.now() - recentMinutes * 60_000 : 0
          const list = (await loadLeads())
            .filter(
              (l) =>
                (status === 'all' || l.status === status) &&
                matchesFilter(l, asText(args.filter)) &&
                (!args.only_with_email || Boolean(l.email)) &&
                (!since || new Date(l.created_at).getTime() >= since) &&
                (typeof args.called !== 'boolean' || Boolean(l.called_at) === args.called) &&
                (!args.only_with_phone || Boolean(l.phone))
            )
            .sort((a, b) => (since ? b.created_at.localeCompare(a.created_at) : 0))
          result = { totale: list.length, schede: list.slice(0, limit).map(compact) }
          if (list.length) focus = { label: asText(args.label) || 'Contatti indicati dall’assistente', ids: list.slice(0, 60).map((l) => l.id) }
          break
        }
        case 'search_places': {
          const query = asText(args.query)?.trim() || ''
          if (query.length < 3) {
            result = { errore: 'query mancante' }
            break
          }
          reportStatus(`Cerco su Google Maps: “${query}”…`)
          const found = await searchPlaces(query, Math.max(1, Math.min(MAX_RESULTS, asNumber(args.max) || 20)))
          result = { trovate: found.found, nuove_aggiunte: found.added }
          if (found.ids.length) focus = { label: `Ricerca “${query}”`, ids: found.ids }
          refresh = true
          break
        }
        case 'analyze': {
          const ids = asIds(args.ids)
          const limit = Math.min(BATCH_LIMIT, asNumber(args.limit) || BATCH_LIMIT)
          const todo = (await loadLeads(ids)).filter((l) => (ids?.length ? true : l.status === 'new' && !l.analyzed_at)).slice(0, limit)
          const { out: done, unfinished } = await inBatches(todo, (lead, position) => {
            reportStatus(`Leggo il sito di ${lead.name} (${position})…`)
            return analyzeLead(lead)
          })
          if (unfinished) more = true
          result = {
            rimasti_da_analizzare: unfinished,
            analizzati: done.length,
            con_email: done.filter((l) => l.email).length,
            senza_email: done.filter((l) => !l.email).map((l) => l.name),
          }
          refresh = true
          break
        }
        case 'prepare_first_emails': {
          const out = await prepareFirst({
            ids: asIds(args.ids),
            filter: asText(args.filter),
            instructions: withLuca(asText(args.instructions)),
            limit: asNumber(args.limit),
            skip: new Set(drafts.keys()),
          })
          for (const d of out.drafts) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          if (out.unfinished && timeIsUp()) more = true
          result = out.result
          refresh = true
          break
        }
        case 'prepare_followups': {
          const out = await prepareFollowups({
            ids: asIds(args.ids),
            filter: asText(args.filter),
            instructions: withLuca(asText(args.instructions)),
            days: asNumber(args.days),
            limit: asNumber(args.limit),
            skip: new Set(drafts.keys()),
          })
          for (const d of out.drafts) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          if (out.unfinished && timeIsUp()) more = true
          result = out.result
          break
        }
        case 'revise_draft': {
          const draft = drafts.get(asText(args.leadId) || '')
          if (!draft) {
            result = { errore: 'bozza non trovata: usa un leadId dell’elenco delle bozze aperte' }
            break
          }
          reportStatus(`Riscrivo la bozza per ${draft.name}…`)
          const revised = await reviseDraft(draft, asText(args.instructions) || '')
          if (revised) {
            drafts.set(revised.leadId, revised)
            changed.set(revised.leadId, revised)
          }
          result = { riscritta: Boolean(revised), nome: draft.name }
          break
        }
        case 'revise_all': {
          const instructions = asText(args.instructions) || ''
          const { out: revised, unfinished } = await inBatches([...drafts.values()], (d, position) => {
            reportStatus(`Riscrivo la bozza per ${d.name} (${position})…`)
            return reviseDraft(d, instructions)
          })
          if (unfinished) result = { nota: `tempo finito, ${unfinished} bozze non riscritte` }
          for (const d of revised) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          result = { riscritte: revised.length, ...(result as object) }
          break
        }
        case 'remove_drafts': {
          for (const id of asIds(args.leadIds) || []) {
            drafts.delete(id)
            changed.delete(id)
            removed.add(id)
          }
          result = { rimaste: drafts.size }
          break
        }
        case 'update_leads': {
          const ids = asIds(args.ids) || []
          const updates: Record<string, unknown> = {}
          const status = asText(args.status)
          if (status && (LEAD_STATUSES as readonly string[]).includes(status)) updates.status = status
          if (asText(args.notes) !== undefined) updates.notes = asText(args.notes)
          if (asText(args.email)) updates.email = asText(args.email)!.trim().toLowerCase()
          if (!ids.length || !Object.keys(updates).length) {
            result = { errore: 'servono ids e almeno un campo' }
            break
          }
          reportStatus('Aggiorno le schede…')
          const { error } = await supabaseAdmin.from('leads').update(updates).in('id', ids)
          result = error ? { errore: error.message } : { aggiornate: ids.length }
          refresh = true
          break
        }
        case 'read_conversation': {
          const lead = (await loadLeads([asText(args.leadId) || '']))[0]
          if (!lead) {
            result = { errore: 'scheda non trovata: usa list_leads per l’id' }
            break
          }
          reportStatus(`Leggo la conversazione con ${lead.name}…`)
          result = await readConversation(lead)
          break
        }
        case 'prepare_reply': {
          const lead = (await loadLeads([asText(args.leadId) || '']))[0]
          if (!lead?.email) {
            result = { errore: lead ? 'la scheda non ha un’email' : 'scheda non trovata: usa list_leads per l’id' }
            break
          }
          reportStatus(`Scrivo la controrisposta per ${lead.name}…`)
          const out = await replyFor(lead, asText(args.instructions), { force: args.force === true })
          result = out.ok
            ? { preparata: true, dove: 'Messaggi, da approvare', testo: out.text }
            : { preparata: false, motivo: out.reason, testo_esistente: out.text }
          refresh = true
          break
        }
        case 'prepare_replies': {
          const redo = Boolean(args.redo)
          const todoIds = (await repliesOverview())
            .filter((r) => r.controrisposta === 'da preparare' || (redo && r.controrisposta.startsWith('in attesa')))
            .map((r) => r.leadId)
          const leads = todoIds.length ? await loadLeads(todoIds) : []
          const { out, unfinished } = await inBatches(
            leads,
            async (lead, position) => {
              reportStatus(`Scrivo la controrisposta per ${lead.name} (${position})…`)
              const res = await replyFor(lead, asText(args.instructions), { redoPending: redo })
              return { nome: lead.name, preparata: res.ok, testo: res.text?.slice(0, 500), motivo: res.reason }
            },
            2
          )
          if (unfinished) more = true
          result = { controrisposte: out, rimaste: unfinished, nota: todoIds.length ? undefined : 'nessuna risposta da preparare' }
          refresh = true
          break
        }
        case 'activity_report': {
          reportStatus('Controllo l’attività del periodo…')
          result = await activityReport({
            hours: asNumber(args.hours),
            from: asText(args.from),
            to: asText(args.to),
            platform: asText(args.platform),
          })
          break
        }
        case 'inspect_website': {
          let url = asText(args.url)
          const leadId = asText(args.leadId)
          if (!url && leadId) url = (await loadLeads([leadId]))[0]?.website || undefined
          if (!url) {
            result = { errore: 'sito non indicato o la scheda non ha un sito' }
            break
          }
          reportStatus(`Leggo le pagine di ${url.replace(/^https?:\/\//, '')}…`)
          result = await inspectWebsite(url)
          break
        }
        case 'instagram_profile': {
          let username = asText(args.username)
          const leadId = asText(args.leadId)
          if (!username && leadId) username = (await loadLeads([leadId]))[0]?.instagram || undefined
          if (!username) {
            result = { errore: 'profilo Instagram non indicato o assente nella scheda' }
            break
          }
          reportStatus(`Guardo il profilo Instagram ${username.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@')}…`)
          result = await fetchInstagramProfile(username)
          break
        }
        case 'instagram_profiles': {
          const ids = asIds(args.ids)
          const limit = Math.min(25, asNumber(args.limit) || 15)
          const leads = (await loadLeads(ids))
            .filter((l) => l.instagram && (ids?.length ? true : matchesFilter(l, asText(args.filter))))
            .slice(0, limit)
          const { out } = await inBatches(leads, async (lead, position) => {
            reportStatus(`Guardo Instagram di ${lead.name} (${position})…`)
            const p = await fetchInstagramProfile(lead.instagram!)
            return { nome: lead.name, leadId: lead.id, ...p, recentPosts: p.recentPosts?.slice(0, 3) }
          }, 3)
          result = { profili: out, schede_senza_instagram: (await loadLeads(ids)).filter((l) => !l.instagram).length }
          break
        }
        case 'list_conversations': {
          const list = await listConversations(asText(args.platform), asText(args.filter), Math.min(50, asNumber(args.limit) || 20))
          result = { conversazioni: list, nota: list.length ? undefined : 'nessuna conversazione trovata con questo filtro: prova con meno parole o senza filtro' }
          break
        }
        case 'read_thread': {
          const platform = asText(args.platform)
          const contactId = asText(args.contactId)
          if (!platform || !contactId) {
            result = { errore: 'servono platform e contactId (da list_conversations)' }
            break
          }
          reportStatus('Leggo la conversazione…')
          result = await readThread(platform, contactId)
          break
        }
        case 'prepare_inbox_reply': {
          const platform = asText(args.platform)
          const contactId = asText(args.contactId)
          if (!platform || !INBOX_PLATFORMS.includes(platform) || !contactId) {
            result = { errore: 'servono platform (email|instagram|facebook|whatsapp|web) e contactId (da list_conversations)' }
            break
          }
          reportStatus('Scrivo la risposta…')
          const out = await prepareInboxReply(platform as SocialPlatform, contactId, withLuca(asText(args.instructions)), asText(args.to))
          result = out.ok
            ? { preparata: true, dove: 'Messaggi, da approvare', destinatario: out.sentTo, testo: out.text, avviso: out.warning }
            : { preparata: false, motivo: out.reason }
          refresh = true
          break
        }
        case 'send_social_message': {
          const platform = asText(args.platform)
          const contactId = asText(args.contactId)
          const text = asText(args.text)?.trim()
          if ((platform !== 'instagram' && platform !== 'facebook') || !contactId || !text) {
            result = { errore: 'servono platform (instagram|facebook), contactId e text' }
            break
          }
          const { data: last } = await supabaseAdmin
            .from('social_messages')
            .select('contact_name, created_at')
            .eq('platform', platform)
            .eq('contact_id', contactId)
            .eq('direction', 'in')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (!last) {
            result = { errore: 'questa persona non ci ha mai scritto su questo canale: non si può scriverle in privato tramite API' }
            break
          }
          const action: SocialAction = {
            kind: 'social_message',
            platform,
            key: await conversationKeyFor(platform, contactId),
            name: last.contact_name || contactId,
            text: text.slice(0, 1900),
            lastIncomingAt: last.created_at,
          }
          actions.push(action)
          result = { preparato: true, nota: 'compare a Luca con il pulsante Invia', entro_24_ore: Date.now() - new Date(last.created_at).getTime() < 24 * 3600_000 }
          break
        }
        case 'site_platforms': {
          const wanted = asText(args.platform)?.trim().toLowerCase()
          const ids = asIds(args.ids)
          const limit = Math.min(150, asNumber(args.limit) || 60)
          const pool = (await loadLeads(ids))
            .filter((l) => l.website && (ids?.length ? true : matchesFilter(l, asText(args.filter))))
            .slice(0, limit)
          const { results, unfinished } = await sitePlatforms(pool)
          const matching = wanted ? results.filter((r) => (r.platform || '').toLowerCase().includes(wanted)) : results
          if (matching.length) {
            focus = { label: wanted ? `Siti ${asText(args.platform)}` : 'Piattaforma dei siti', ids: matching.map((r) => r.lead.id) }
          }
          result = {
            controllati: results.length,
            da_controllare_ancora: unfinished,
            trovati: matching.length,
            schede: matching.slice(0, 60).map((r) => ({ ...compact(r.lead), piattaforma: r.platform || (r.reachable ? 'non riconosciuta' : 'sito non raggiungibile') })),
            con_email: matching.filter((r) => r.lead.email).length,
            gia_contattati: matching.filter((r) => r.lead.contacted_at).length,
          }
          if (unfinished && timeIsUp()) more = true
          break
        }
        case 'add_contact': {
          reportStatus('Salvo il contatto in rubrica…')
          const saved = await addContact(args, SOURCE_CHAT)
          refresh = true
          result = {
            salvato: true,
            nuovo: saved.created,
            nota: saved.created ? 'aggiunto alla rubrica' : 'esisteva già: completati i campi mancanti',
            contatto: compact(saved.lead),
          }
          break
        }
        case 'list_push_devices': {
          reportStatus('Controllo i dispositivi che ricevono le notifiche…')
          result = { dispositivi: await listPushDevices() }
          break
        }
        case 'test_push': {
          const known = new Set((await listPushDevices()).map((d) => d.id))
          const ids = asIds(args.deviceIds)?.filter((id) => known.has(id))
          if (asIds(args.deviceIds)?.length && !ids?.length) {
            result = { errore: 'nessun dispositivo con questi id: usa list_push_devices' }
            break
          }
          reportStatus('Invio una notifica di prova…')
          result = await sendPushToAdmins(
            { title: 'Notifica di prova', body: asText(args.text)?.slice(0, 200) || 'Prova dalla super chat: questo dispositivo riceve le notifiche.', url: '/admin/assistant' },
            ids
          )
          break
        }
        case 'rename_push_device': {
          const id = asText(args.deviceId)
          const name = asText(args.name)?.trim().slice(0, 60)
          if (!id || !name || !(await listPushDevices()).some((d) => d.id === id)) {
            result = { errore: 'servono deviceId valido (da list_push_devices) e name' }
            break
          }
          await updateDeviceInfo(id, { name })
          result = { rinominato: true, name }
          break
        }
        case 'remove_push_device': {
          const known = new Map((await listPushDevices()).map((d) => [d.id, d.name]))
          const ids = (asIds(args.deviceIds) || []).filter((id) => known.has(id))
          if (!ids.length) {
            result = { errore: 'nessun dispositivo con questi id: usa list_push_devices' }
            break
          }
          for (const id of ids) await removePushDevice(id)
          result = { rimossi: ids.map((id) => known.get(id)), nota: 'per riattivarlo, apri Messaggi da quel dispositivo e attiva le notifiche' }
          break
        }
        default:
          result = { errore: `strumento sconosciuto: ${call.tool}` }
      }
    } catch (error) {
      result = { errore: error instanceof Error ? error.message : 'errore' }
    }

    try {
      progress?.onStep?.(stepLine(call.tool || '?', args, result))
    } catch {}
    transcript.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args }) })
    transcript.push({ role: 'user', content: `Risultato di ${call.tool}: ${JSON.stringify(result).slice(0, 12000)}` })
    // Ogni passo rimanda all'AI tutta la conversazione: i risultati vecchi si accorciano
    // (restano interi gli ultimi due), cosi' il costo non cresce passo dopo passo.
    const results = transcript.filter((m) => m.role === 'user' && m.content.startsWith('Risultato di '))
    for (const m of results.slice(0, -2)) {
      if (m.content.length > 1500) m.content = `${m.content.slice(0, 1500)}… (accorciato: dettagli già usati)`
    }
  }

  // Passi del giro finiti ma lavoro non concluso: si prosegue da soli nel giro successivo.
  more = true
  return finish('Sto ancora lavorando: continuo con il resto…')

  function finish(reply: string, confirmSend = false): AssistantResult {
    return {
      reply,
      drafts: [...changed.values()],
      removeDrafts: [...removed],
      refresh,
      confirmSend: confirmSend && drafts.size > 0,
      more,
      focus,
      actions,
    }
  }
}
