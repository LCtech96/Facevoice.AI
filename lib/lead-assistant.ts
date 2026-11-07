import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseToolStep, looksLikeToolCall, cleanReplyText, FORMAT_RETRY } from '@/lib/tool-step'
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
import { loadKnowledge, prepareInboxReply, prepareOutreachReply, type SocialPlatform } from '@/lib/meta/agent'
import { pollGmail } from '@/lib/gmail-poll'
import { previewThreadReply } from '@/lib/gmail'
import { withCalls } from '@/lib/lead-calls'
import { SOURCE_CHAT, addContact } from '@/lib/contacts'
import { noteLeadFields } from '@/lib/lead-origin'
import { inspectWebsite, platformOf } from '@/lib/site-inspect'
import { fetchInstagramProfile } from '@/lib/meta/graph'
import { listPushDevices, sendPushToAdmins, updateDeviceInfo } from '@/lib/push'
import { loadBlogAutoSettings, loadBlogAutoState, type BlogAutoSettings } from '@/lib/blog-auto'
import { loadContentDirections, saveContentDirections } from '@/lib/content-directions'
import { SITE_URL } from '@/lib/seo/site'
import { createPostDraft, DraftConflictError, loadPostDraft, recentPostDrafts, type PostDraft } from '@/lib/social-posts'
import { arrangeSlides, carouselOutline, editSlidesAI, isEditable } from '@/lib/carousel-edit'
import { carouselDraftFromBlogPost } from '@/lib/blog-share'
import {
  cardFor,
  createPendingAction,
  describeForModel,
  recentActions,
  stateOf,
  type ConfirmCard,
  type ConfirmKind,
  type ConfirmPayload,
  type ConfirmScope,
  type PendingAction,
} from '@/lib/assistant-confirm'
import {
  DOC_DISCLAIMER,
  DOC_KIND_LABEL,
  PLATFORM_LABEL,
  addDocumentVersion,
  asDocKind,
  describeSource,
  documentCard,
  findVersion,
  latestVersion,
  loadDocument,
  loadTranscript,
  recentDocuments,
  resolveConversation,
  reviseDocument,
  saveNewDocument,
  writeDocument,
  type DocVersion,
  type DocumentCard,
  type Transcript,
} from '@/lib/assistant-documents'
import { pdfFilename } from '@/lib/pdf-doc'

// Agente della Ricerca clienti. Riceve una richiesta in linguaggio naturale e
// la porta a termine usando degli strumenti (cercare, analizzare, preparare
// email, riscrivere una bozza, aggiornare schede, scrivere documenti in PDF),
// anche in piu' passaggi. Doppia conferma: niente esce dalla chat (email,
// messaggi, pubblicazioni, cancellazioni) senza il clic di Luca sulla scheda di
// conferma (lib/assistant-confirm).

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
  /** Schede sotto la risposta: conferme da approvare, caroselli, documenti. */
  actions?: SocialAction[]
}

export type SocialAction =
  | ConfirmCard
  | DocumentCard
  | {
      /** Scheda di prima (chat vecchie): messaggio con il pulsante Invia. Le nuove sono "confirm". */
      kind: 'social_message'
      platform: 'instagram' | 'facebook'
      key: string
      name: string
      text: string
      /** Ultimo messaggio ricevuto da quella persona: Meta permette risposte libere entro 24 ore. */
      lastIncomingAt: string | null
    }
  | {
      /** Carosello in bozza: Luca lo vede, puo' cambiare i testi e lo pubblica con un pulsante. */
      kind: 'post_preview'
      draftId: string
      title: string
      urls: string[]
      caption: string
      facebook: string
      platforms?: ('instagram' | 'facebook')[]
      /** Si possono toccare le singole slide (modificare, spostare, togliere). */
      editable?: boolean
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
Se nella richiesta c'è "[Contenuto delle immagini allegate da Luca]", è la trascrizione degli screenshot o delle foto che Luca ti ha mandato: usala come se la vedessi (nomi, email, oggetti, importi, conversazioni) e per cercare le persone con list_conversations o list_leads. Le immagini stesse sono salvate e si possono usare nei caroselli (create_carousel).
Non rispondere MAI "non posso" o "devi farlo tu" se c'è uno strumento che lo fa: usalo. Per post, caroselli, blog e contenuti hai gli strumenti della sezione "Contenuti di Facevoice".

A ogni passo rispondi SOLO con un JSON (niente testo prima o dopo, niente tag come <function_calls>), in uno di questi due formati:
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
Se Luca dice "senza fare nulla" / "senza compiere azioni", usa solo strumenti di lettura (stats, list_leads, activity_report, read_conversation, list_conversations, read_thread, inspect_website, instagram_profile, list_push_devices, list_documents).

Strumenti di ricerca e social:
- "inspect_website": {"leadId": "..."} oppure {"url": "https://..."} → legge il sito (fino a 10 pagine): elenco pagine con titolo e contenuto, piattaforma (WordPress, Wix…), anno più recente citato e copyright (per capire se è aggiornato), funzioni presenti (prenotazioni, shop, blog, newsletter, WhatsApp, Analytics, Pixel), link social. Poi spiega tu a Luca, in parole semplici, che pagine ci sono, di cosa parlano, se il sito sembra usato attivamente e cosa manca.
- "instagram_profile": {"username": "nomeprofilo"} oppure {"leadId": "..."} → profilo Instagram pubblico (solo account business/creator): follower, seguiti, numero di post, bio, sito, ultimi 6 post con data, like e commenti (per capire se pubblicano e quanto spesso).
- "instagram_profiles": {"ids": [...] opzionale, "filter": "", "limit": 15} → lo stesso per più schede che hanno un Instagram (per domande tipo "quali hanno Instagram e quanti follower").
- "list_conversations": {"platform": "email|instagram|facebook|whatsapp|web|all", "filter": "parole da cercare, opzionale", "limit": 20} → conversazioni della casella Messaggi su TUTTI i canali, email comprese (platform, contactId, nome, ultimo messaggio, data). Il filtro cerca in nome, indirizzo e testo dei messaggi (anche l'oggetto delle email) e ignora spazi e maiuscole: "Galdieri Rent" trova anche "Galdierirent". Se Luca nomina una persona o un'azienda che non è nella lista Clienti, cercala QUI prima di dire che non esiste.
- "read_thread": {"platform": "...", "contactId": "..."} → legge gli ultimi messaggi di una conversazione qualsiasi di Messaggi (ricevuti, inviati, bozze).
- "prepare_inbox_reply": {"platform": "...", "contactId": "...", "instructions": "cosa vuole Luca", "to": "email, solo se Luca indica un indirizzo diverso"} → prepara la risposta a una conversazione qualsiasi di Messaggi (email, Instagram, Messenger, WhatsApp, chat del sito) seguendo le indicazioni di Luca e la mette da approvare in Messaggi (non parte da sola). Per chi è nella lista Clienti e ha risposto alle nostre email usa invece prepare_reply.
REGOLA: se Luca ti chiede di rispondere a qualcuno, non dirgli mai "non lo trovo" o "dammi l'email" prima di aver cercato con list_conversations (anche solo con una parte del nome o dell'azienda). Quando lo trovi, prepara SEMPRE la risposta con prepare_inbox_reply, anche se l'ultima email è una ricevuta o arriva da un indirizzo automatico (no-reply): lo strumento trova da solo l'indirizzo vero dell'azienda. Poi dici a Luca a chi va (destinatario) e riporti l'avviso se c'è.
- "send_social_message": {"platform": "instagram|facebook", "contactId": "...", "text": "..."} → PREPARA un messaggio Instagram/Facebook a una persona della casella (contactId da list_conversations). NON parte: a Luca compare la scheda di conferma con il testo esatto e i pulsanti «Accetta e invia» / «Scarta». Regola di Meta: si può scrivere solo a chi ci ha già scritto, e liberamente entro 24 ore dal suo ultimo messaggio; a nuovi profili mai contattati non si può scrivere in privato tramite API (suggerisci di commentare un loro post o scrivere dal telefono).

Piattaforma dei siti:
- "site_platforms": {"platform": "WordPress", "ids": [...] opzionale, "filter": "testo opzionale", "limit": 60} → controlla con cosa è fatto il sito di ogni scheda con un sito (WordPress, Wix, Shopify, Squarespace, Webflow, Jimdo, su misura) e restituisce quelle con la piattaforma chiesta (senza "platform": tutte, con la piattaforma di ciascuna). Le schede trovate vengono MOSTRATE a Luca nella lista. Usalo per richieste tipo "quali contatti hanno un sito WordPress" o prima di scrivere a chi usa una certa piattaforma (es. un avviso di sicurezza per WordPress/PHP): poi usa prepare_first_emails con quegli "ids" per chi non è ancora stato contattato e prepare_followups con quegli "ids" e "days": 0 per chi è già stato contattato, passando il testo o le indicazioni di Luca in "instructions".

Rubrica contatti (pagina Contatti, dove finiscono anche tutte le schede delle ricerche):
- "add_contact": {"name": "...", "phone": "...", "email": "...", "website": "...", "address": "...", "instagram": "...", "facebook": "...", "notes": "..."} → aggiunge un contatto alla rubrica. Usalo quando Luca detta o scrive i dati di un cliente o di una persona (anche a voce, es. "aggiungi Mario Rossi della pizzeria Da Mario, numero 333 1234567, vuole un sito"). Solo "name" è obbligatorio; metti in "notes" quello che non rientra negli altri campi (chi è, cosa vuole, quando richiamarlo). Non inventare dati: se un campo non è stato detto, omettilo. Se il contatto esiste già (stessa email, telefono o nome) vengono completati solo i campi mancanti. Per più contatti chiamalo più volte. Nella risposta conferma in breve cosa hai salvato.
- Per cercare o elencare contatti già salvati usa "list_leads" (con "filter" sul nome).

Strumenti per le notifiche push (i dispositivi su cui arrivano gli avvisi di Messaggi, richieste di accesso, ecc.):
- "list_push_devices": {} → tutti i dispositivi che ricevono le notifiche: id, nome, browser e sistema (es. "Chrome su Windows", "Safari su iPhone"), se è l'app installata, email dell'account, data di registrazione, ultima apertura di Messaggi, ultima notifica consegnata, ultimo errore. Se "knownDetails" è false il dispositivo è stato registrato prima che salvassimo il browser: il tipo è dedotto dal servizio push; si completa da solo quando Luca apre Messaggi da quel dispositivo. Usalo per domande tipo "quali dispositivi ricevono le notifiche".
- "test_push": {"deviceIds": [...] opzionale, "text": "testo opzionale"} → invia una notifica di prova a quei dispositivi (o a tutti) e dice quanti l'hanno ricevuta. Utile per capire quale dispositivo è quale.
- "rename_push_device": {"deviceId": "...", "name": "iPhone di Luca"} → dà un nome a un dispositivo.
- "remove_push_device": {"deviceIds": [...]} → prepara la rimozione di quei dispositivi dalle notifiche: compare la scheda di conferma, si tolgono solo quando Luca preme «Conferma». Usalo SOLO se Luca chiede esplicitamente di togliere/disattivare un dispositivo.
Nella risposta descrivi i dispositivi in modo semplice (nome, tipo, da quando, ultima notifica ricevuta), con date e ore in italiano; non mostrare gli id se non servono.

Contenuti di Facevoice (blog automatico, caroselli e post su Instagram e Facebook):
- "content_settings": {} → come funziona ora: blog automatico acceso o spento, giorni e ora di pubblicazione, condivisione su Facebook e Instagram, ultimo articolo e com'è andato, e le INDICAZIONI di Luca salvate per i contenuti.
- "set_content_directions": {"text": "indicazioni", "mode": "append|replace|clear"} → salva le indicazioni di Luca per i prossimi contenuti (argomenti, taglio, tono, gancio della copertina, stile e colori delle immagini, cosa evitare). Le seguono la scrittura degli articoli, le slide, il gancio della prima slide e le immagini generate, finché Luca non le cambia. "append" aggiunge alle indicazioni esistenti (predefinito), "replace" prepara la sostituzione (scheda di conferma con le vecchie e le nuove: si sostituiscono solo con «Conferma»; se non ce n'erano si salvano subito), "clear" prepara la cancellazione (scheda di conferma: si cancellano solo con «Conferma»). Riscrivi le parole di Luca come indicazioni chiare e brevi, senza perdere nulla. Usalo quando Luca dice cosa fare con i prossimi post, blog o caroselli.
- "update_blog_schedule": {"enabled": true, "days": [2, 5], "time": "09:40", "shareFacebook": true, "shareInstagram": true} → prepara la modifica del blog automatico (days: 0 = domenica … 6 = sabato; ora italiana): compare la scheda di conferma, cambia solo quando Luca preme «Conferma». Metti solo i campi da cambiare.
- "publish_blog_now": {} → prepara la pubblicazione SUBITO di un articolo con le notizie più recenti, poi il carosello su Facebook e Instagram: compare la scheda di conferma, parte solo con «Conferma». Usalo SOLO se Luca chiede esplicitamente di pubblicare adesso. Dopo la conferma ci vogliono alcuni minuti: arriva una notifica con l'esito.
- "create_carousel": {"brief": "cosa vuole Luca: argomento, messaggio, tono, a chi si rivolge, dettagli", "slide_count": 3, "from_draft": "opzionale", "images": ["https://…"] opzionale, "image_notes": "cosa c'è nelle immagini, opzionale", "only_my_images": false, "hook": "opzionale", "slides": [{"title": "", "text": ""}] opzionale} → CREA un carosello (Instagram e Facebook) e lo mostra a Luca in anteprima con il pulsante Pubblica: NON lo pubblica. "slide_count": numero TOTALE di immagini chiesto da Luca, copertina e slide finale comprese ("tre slide" → 3, da 2 a 10); ometti se Luca non dice un numero. "slides" sono solo le slide di contenuto, senza copertina e senza slide finale (con slide_count 3 c'è 1 sola slide di contenuto). Se Luca ha allegato immagini o screenshot (righe "[Immagini allegate da Luca…]" o "[Immagini mandate da Luca prima…]"), usale: se non passi "images" prende da solo quelle allegate a questa richiesta; la prima va in copertina, le altre una per slide, mostrate intere. Le slide senza foto di Luca ricevono un'immagine generata dall'AI (only_my_images: true per evitarlo). In "brief" metti tutto quello che Luca ha detto e quello che si vede nelle immagini: l'AI scrive gancio, slide, didascalia Instagram e testo Facebook. Ci vuole circa un minuto. Usalo SEMPRE quando Luca chiede un post, un carosello o un contenuto da pubblicare, con o senza immagini: non dire mai che non puoi. Con "from_draft": "draftId" rifà un carosello già creato con gli stessi testi, gancio, foto e numero di slide (es. un carosello di prima che non si può correggere slide per slide): gli altri campi solo se Luca chiede cambiamenti.
- "publish_carousel": {"draftId": "...", "platforms": ["instagram", "facebook"], "caption": "opzionale"} → prepara la pubblicazione di un carosello creato prima (anche quelli del blog), solo dove non è già uscito: compare la scheda di conferma con slide e didascalia, esce solo quando Luca preme «Pubblica». Usalo SOLO se Luca dice esplicitamente di pubblicarlo/ripubblicarlo; altrimenti lascia che prema Pubblica sull'anteprima.
- "recent_posts": {"limit": 10} → ultimi caroselli (del blog automatico e della super chat): titolo, data, dove sono usciti, errori, draftId e anteprima. Usalo quando Luca chiede se un post è uscito, perché non si è pubblicato o di ripubblicarlo: poi mostra l'anteprima con show_post o ripubblica con publish_carousel se Luca lo chiede.
- "show_post": {"draftId": "..."} → mostra a Luca l'anteprima di un carosello già creato con il pulsante Pubblica (per ripubblicarlo dove non è uscito).
- "edit_carousel": {"draftId": "opzionale, senza = l'ultimo carosello", "slides": [2], "instruction": "cosa cambiare, con le parole di Luca"} → cambia SOLO le slide indicate (numeri da 1: la 1 è la copertina, l'ultima è la slide finale) di un carosello non ancora pubblicato: testi, oppure un'immagine nuova o nessuna immagine se Luca lo chiede. Le altre slide restano identiche. Poi mostra l'anteprima aggiornata. Usalo quando Luca chiede di correggere una slide (es. "nella seconda slide scrivi …").
- "arrange_carousel": {"draftId": "opzionale, senza = l'ultimo carosello", "order": [1, 3, 2, 4]} → nuovo ordine delle slide con i numeri attuali; quelle non elencate vengono TOLTE. La copertina resta la prima; la slide finale resta l'ultima (si può solo togliere); servono almeno 2 slide. Usalo quando Luca chiede di spostare o togliere slide. Poi mostra l'anteprima aggiornata.
- "carousel_from_blog": {"slug": "opzionale, senza = ultimo articolo", "slide_count": 3} → rifà da zero il carosello di un articolo già pubblicato nel blog (nuove immagini, nuovo gancio, colori diversi) e lo mostra in anteprima con il pulsante Pubblica. "slide_count" come in create_carousel (immagini in tutto, copertina e slide finale comprese); ometti se Luca non dice un numero.
Già oggi, senza indicazioni, ogni carosello ha: un gancio fortissimo scritto in grande sulla prima slide, un'immagine generata dall'AI in copertina e nelle slide, e colori che cambiano a ogni post restando nella palette di Facevoice.

Documenti (contratti, preventivi, accordi, lettere: Luca li apre in PDF con un tocco, li legge, li stampa o li scarica):
- "create_document": {"kind": "contratto|preventivo|accordo|lettera|altro", "title": "opzionale", "about": {"platform": "instagram|facebook|whatsapp|email|web, opzionale", "contact": "nome, @username, email o contactId, come l'ha detto Luca"}, "instructions": "cosa vuole Luca, con le sue parole"} → scrive il documento usando TUTTA la conversazione con quella persona su quel canale (messaggi ricevuti, nostre risposte automatiche e scritte a mano, con le date) e i dati di Facevoice AI, e mostra a Luca la scheda del PDF con «Apri PDF» e «Scarica». Se più persone (o più canali) corrispondono restituisce l'elenco: chiedi a Luca quale e richiamalo con about.platform e about.contact = contactId. Se non trova nessuno, dillo e chiedi il nome esatto o il canale. Senza "about" scrive il documento solo dalla richiesta. Usalo SEMPRE quando Luca chiede di sviluppare, scrivere o preparare un contratto, un preventivo, un accordo, una lettera o un altro documento (anche "a proposito della conversazione con <nome>"): non dire mai che non puoi. Ci vuole circa un minuto.
- "update_document": {"document_id": "opzionale, senza = l'ultimo documento", "instructions": "cosa cambiare, con le parole di Luca (es. cambia la clausola 3, aggiungi la penale)"} → nuova versione dello stesso documento con la modifica; le versioni di prima restano scaricabili. Usalo per ogni modifica a un documento già fatto.
- "list_documents": {} → ultimi documenti (document_id, titolo, tipo, versione, data).
- "send_document": {"document_id": "opzionale", "version": "numero, opzionale", "to": "email, opzionale", "text": "testo dell'email che accompagna il PDF"} → PREPARA l'invio del PDF per email (nella conversazione email da cui nasce il documento, o all'indirizzo "to" dato da Luca): compare la scheda di conferma, parte solo con «Accetta e invia». Su Instagram, Facebook, WhatsApp e chat del sito non si possono allegare file da qui: spiega a Luca che può aprire il PDF, scaricarlo e mandarlo dall'app (o darti un'email della persona).
Dopo create_document o update_document la risposta dice in 2-3 frasi cosa contiene e su quale conversazione si basa, elenca i punti DA COMPLETARE e scrive UNA volta: "${DOC_DISCLAIMER}" Non incollare il testo del documento in chat: è nel PDF.

Se Luca fa una domanda generale (consigli, idee, strategia, testi), rispondi direttamente senza strumenti.

DOPPIA CONFERMA (regola obbligatoria): niente esce dalla chat e niente si cancella senza il clic di Luca. Gli strumenti che inviano, pubblicano, cambiano il blog automatico, tolgono dispositivi o cancellano indicazioni NON eseguono: creano una scheda "in attesa di conferma" con il contenuto esatto e i pulsanti «Accetta e invia» (o «Conferma» / «Pubblica») e «Scarta». Quindi:
- Non dire mai che hai inviato, pubblicato, programmato o cancellato qualcosa finché la sezione "Azioni da confermare" non dice FATTO: di' che è pronto e che parte quando preme il pulsante sulla scheda.
- Se Luca scrive in chat "sì", "ok invia", "manda", "conferma", "pubblica" per una scheda in attesa: non dire che è partito; ricordagli in una frase che deve premere il pulsante sulla scheda (è l'unico modo). Se non trovi la scheda, richiama lo stesso strumento con lo stesso contenuto: ricompare la stessa scheda, non un doppione.
- Se una scheda è SCARTATA (o Luca scrive "Ho scartato…"), non riproporre la stessa cosa: chiedigli in breve cosa gli serve davvero o cosa cambiare.
- Bozze, documenti, letture e analisi non hanno bisogno di conferma.

Invio email: tu NON invii email. Se Luca chiede di inviare/mandare le bozze aperte, rispondi con {"reply": "...", "confirm_send": true}: comparirà a Luca la scheda di conferma con l'elenco esatto delle email e i pulsanti «Accetta e invia» / «Scarta». Non dire che sono partite.

Scrivi le risposte finali in testo semplice: niente markdown, niente asterischi. Regole: non inventare id (usa list_leads), al massimo ${MAX_STEPS} passi, risposta finale breve con cosa hai fatto e cosa resta (es. contatti senza email: suggerisci di scrivergli sui social o chiamarli).`

type ToolCall = { tool?: string; args?: Record<string, unknown>; reply?: string; confirm_send?: boolean }

function parseStep(raw: string): ToolCall | null {
  return parseToolStep(raw) as ToolCall | null
}

const asIds = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined)
const asText = (value: unknown) => (typeof value === 'string' ? value : undefined)
const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const COUNT_WORDS: Record<string, number> = { due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 }

/**
 * Numero di slide scritto da Luca nella sua richiesta ("tre slide", "5 slide"): sono
 * le immagini in tutto, copertina e slide finale comprese. "immagini" non conta:
 * "le 3 immagini" sono le foto che manda, non le slide.
 */
function slideCountFrom(message: string): number | undefined {
  // Solo le parole di Luca: non la trascrizione delle immagini allegate.
  const own = message.split(/\n\[(?:Contenuto delle immagini|Immagini allegate|Immagini mandate)/)[0]
  const found = own.match(/(?:^|[^\p{L}\d])(\d{1,2}|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+slides?(?![\p{L}\d])/iu)?.[1]?.toLowerCase()
  if (!found) return undefined
  return COUNT_WORDS[found] ?? Number(found)
}

/** Numero dato dall'agente (anche come testo "3"). */
const asCount = (value: unknown) => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** Caroselli: cambiarli e pubblicarli spetta solo all'amministratore (come la scheda). */
const ONLY_ADMIN = 'chi scrive non è l’amministratore: solo l’amministratore può cambiare o pubblicare i caroselli (dall’anteprima)'
/** Documenti: contengono dati personali, li crea e li apre solo l'amministratore (come la route del PDF). */
const ONLY_ADMIN_DOCS = 'chi scrive non è l’amministratore: solo l’amministratore può creare, modificare e aprire i documenti'

/**
 * "Inviato", "è stato pubblicato", "messaggio partito"…: frase falsa finché la scheda di
 * conferma non è stata premuta (participio con o senza "ho / è stato" davanti).
 */
const DONE_WORD = /(?:inviat|mandat|spedit|pubblicat|programmat|partit|uscit|consegnat|recapitat)[oaie](?![\p{L}\d])/giu
/** Per le cancellazioni e sostituzioni in attesa: "cancellate", "tolti", "sostituite"… */
const REMOVED_WORD = /(?:cancellat|rimoss|tolt|sostituit|eliminat)[oaie](?![\p{L}\d])/giu
/** Subito prima del participio: "non è (ancora) partito", "verrà inviato", "niente è stato inviato". */
const NEGATED = /(?:^|[^\p{L}])(?:non|né|ne'|nessun[oa]?|niente|nulla|verr\p{L}*|sar[àa]|saranno|pront[oaie]|in attesa)(?![\p{L}])/iu
/** Condizione sul clic: "parte quando premi", "sarà inviato solo dopo la conferma". */
const CONDITIONAL = /(?:^|[^\p{L}])(?:(?:quando|appena|se|dopo che) (?:premi|confermi|accetti|clicchi|tocchi)|solo (?:con|quando|dopo|se)|dopo (?:il tuo |la tua |il |la )?(?:clic|conferma)|una volta (?:confermat|accettat|premut)|finch[ée] non|prima di)/iu
const DELETE_KINDS: ConfirmKind[] = ['remove_push_devices', 'clear_content_directions', 'replace_content_directions']
/** La frase dice che qualcosa è già stato fatto (non al negativo, non al futuro, non "quando premi"). */
function claimsDone(sentence: string, deletions: boolean): boolean {
  if (CONDITIONAL.test(sentence)) return false
  for (const pattern of deletions ? [DONE_WORD, REMOVED_WORD] : [DONE_WORD]) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
      const at = m.index
      if (at > 0 && /[\p{L}\d]/u.test(sentence[at - 1])) continue
      if (!NEGATED.test(sentence.slice(Math.max(0, at - 28), at))) return true
    }
  }
  return false
}
/** Frase su qualcosa fatto in passato (azioni FATTE dei giorni prima). */
const PAST_TIME = /(?:^|[^\p{L}])(?:ieri|l['’]altro ieri|stamattina|stamani|in precedenza|giorni fa|settimane? fa|settimana scorsa|mese scorso)(?![\p{L}])/iu
/** Parole troppo comuni per riconoscere di quale azione parla una frase. */
const GENERIC_WORDS = new Set(['messaggio', 'messaggi', 'email', 'mail', 'documento', 'carosello', 'instagram', 'facebook', 'pubblicare', 'inviare', 'mandare', 'articolo', 'blog', 'indicazioni', 'contenuti', 'notifiche', 'subito', 'adesso', 'della', 'delle', 'degli', 'nella', 'sulla', 'questo', 'questa', 'automatico', 'cancellare', 'sostituire', 'togliere', 'dispositivi', 'programma'])
/** Parole che riconoscono un'azione (persona, titolo del carosello…). */
function actionWords(action: PendingAction): Set<string> {
  const p = action.payload
  const raw = [action.title, 'name' in p ? p.name : '', p.kind === 'send_emails' ? p.drafts.map((d) => d.name).join(' ') : '', p.kind === 'publish_carousel' ? p.title : '']
  return new Set(raw.join(' ').toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)))
}
const mentions = (sentence: string, words: Set<string>) => sentence.toLowerCase().split(/[^\p{L}\d]+/u).some((w) => words.has(w))
/** Parole che da sole fanno una conferma scritta ("sì", "ok invia", "manda pure"…). */
const YES_WORD = /^(?:s[iì]+|ok+|okay|certo|esatto|perfetto|procedi|conferm[aoi]|vai|bene|d'accordo|invia(?:lo|la|li|le)?|manda(?:lo|la|li|le)?|spedisci(?:lo|la|li|le)?|pubblica(?:lo|la|li|le)?)$/
const YES_FILLER = /^(?:va|pure|ora|adesso|subito|allora|il|lo|la|i|le|l'|messaggio|email|mail|carosello|post|documento|tutto|tutte|tutti)$/
/**
 * Conferma scritta in chat, che non fa mai partire niente: solo se il messaggio intero è
 * una conferma ("sì", "ok invia", "sì manda pure il messaggio"), non "ok fammi un carosello".
 */
function isTypedYes(message: string): boolean {
  const words = message.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\s']+/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 6) return false
  return words.some((w) => YES_WORD.test(w)) && words.every((w) => YES_WORD.test(w) || YES_FILLER.test(w))
}
const MAX_EMAILS_PER_CARD = 30
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Anteprima del carosello sotto la risposta (con il pulsante Pubblica). */
function postPreview(draft: PostDraft): Extract<SocialAction, { kind: 'post_preview' }> {
  const missing = (['instagram', 'facebook'] as const).filter((p) => !draft.results?.[p])
  return {
    kind: 'post_preview',
    draftId: draft.id,
    title: draft.title,
    urls: draft.urls,
    caption: draft.caption,
    facebook: draft.facebook,
    ...(draft.results && missing.length ? { platforms: [...missing] } : {}),
    editable: isEditable(draft),
  }
}

/** Carosello indicato dall'agente o, senza draftId, l'ultimo creato o cambiato. */
async function targetDraft(id: string | undefined): Promise<PostDraft | null> {
  if (id?.trim()) return loadPostDraft(id.trim())
  return (await recentPostDrafts(1))[0] ?? null
}

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
  progress?: Progress,
  /**
   * admin: la richiesta e' dell'amministratore (solo lui cambia e pubblica i caroselli e crea documenti);
   * email: chi ha scritto (salvato nelle azioni da confermare); scope: chat da cui arriva la richiesta.
   */
  who: { admin?: boolean; email?: string | null; scope?: ConfirmScope } = {}
): Promise<AssistantResult> {
  if (!hasAIProvider()) return { reply: 'Manca una chiave AI (Gemini o Claude): l’assistente non può lavorare.' }

  // Foto e screenshot allegati da Luca (salvati come file pubblici): servono a create_carousel.
  const attachedImages = [...new Set(message.match(/https:\/\/\S+\/blog-images\/chat\/[\w.-]+\.jpg/g) || [])]
  const attachedNotes = message.split('[Contenuto delle immagini allegate da Luca]')[1]?.split('\n[')[0]?.trim() || ''
  const drafts = new Map(openDrafts.map((d) => [d.leadId, d]))
  const changed = new Map<string, Draft>()
  const removed = new Set<string>()
  let refresh = false
  let more = false
  let focus: AssistantResult['focus']
  const actions: SocialAction[] = []
  const scope: ConfirmScope = who.scope ?? 'super'
  // Azioni create in questo giro (in attesa del clic) e documenti scritti o cambiati.
  const queued: PendingAction[] = []
  const docsTouched: DocVersion[] = []

  // Prima di tutto la casella: le risposte arrivate in questo momento devono essere gia' note.
  reportStatus('Controllo la casella per nuove risposte…')
  await pollGmail().catch((error) => console.error('lead assistant poll:', error))
  const replies = await repliesOverview().catch(() => [])
  const waiting = await recentActions(scope, 8).catch(() => [] as PendingAction[])
  // Conferma scritta in chat con una scheda ancora aperta: si indica il pulsante, non parte niente.
  const openBefore = waiting.filter((a) => stateOf(a) === 'pending')
  const typedYes = isTypedYes(message)

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
    waiting.length
      ? `Azioni da confermare (stato attuale dal server, dalla più recente: vale questo, non quello che dice la conversazione):\n${waiting.map(describeForModel).join('\n')}`
      : '',
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

  /**
   * Doppia conferma: l'azione non parte, diventa una scheda con il contenuto esatto.
   * La stessa azione gia' in attesa ricompare (stessa scheda, nessun doppione).
   */
  const queue = async (title: string, payload: ConfirmPayload) => {
    const { action, duplicate } = await createPendingAction({ scope, title, payload, createdBy: who.email ?? null })
    const card = cardFor(action)
    actions.push(card)
    // Anche la scheda ricomparsa conta: finche' non c'e' il clic non si dice "inviato".
    if (!queued.some((a) => a.id === action.id)) queued.push(action)
    return {
      in_attesa_di_conferma: true,
      id: action.id,
      nota: duplicate
        ? `questa stessa azione era già in attesa: ho rimesso sotto la tua risposta la stessa scheda. Ricorda a Luca che parte solo quando preme «${card.confirmLabel}»`
        : `NON è partito niente: sotto la tua risposta compare a Luca la scheda con il contenuto esatto e i pulsanti «${card.confirmLabel}» / «Scarta». Parte solo con il suo clic: non dire che è stato fatto`,
    }
  }

  /** Bozze email aperte -> scheda di conferma con l'elenco esatto (al posto della vecchia conferma del browser). */
  const queueEmails = async () => {
    const list = [...drafts.values()].slice(0, MAX_EMAILS_PER_CARD)
    if (!list.length) return null
    return queue(`${list.length === 1 ? '1 email' : `${list.length} email`} da inviare`, {
      kind: 'send_emails',
      drafts: list.map((d) => ({ leadId: d.leadId, name: d.name, email: d.email, kind: d.kind, subject: d.subject, body: d.body, threadId: d.threadId ?? null })),
    })
  }

  /** Documento da cambiare o inviare: quello indicato, altrimenti l'ultimo. */
  const pickDocument = async (id: string | undefined) => {
    const target = id?.trim() || (await recentDocuments(1))[0]?.id
    return target ? loadDocument(target) : null
  }

  let formatRetried = false
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
    if (!call) {
      // Formato sbagliato (es. <function_calls> o JSON rotto): si fa rifare il passo una volta,
      // invece di mostrare il testo grezzo con lo strumento mai partito.
      if (looksLikeToolCall(raw) && !formatRetried) {
        formatRetried = true
        console.warn('Super chat: passo in formato sbagliato, lo faccio rifare')
        transcript.push({ role: 'assistant', content: raw.slice(0, 6000) })
        transcript.push({ role: 'user', content: FORMAT_RETRY })
        continue
      }
      const text = cleanReplyText(raw)
      return finish(text && !looksLikeToolCall(text) ? text : 'Non sono riuscito a completare la richiesta, puoi riprovare?')
    }
    if (call.reply !== undefined && !call.tool) {
      // "Invia le bozze": niente conferma del browser, una scheda con l'elenco esatto delle email.
      let reply = cleanReplyText(call.reply) || call.reply
      if (call.confirm_send && drafts.size) {
        await queueEmails().catch((error) => console.error('super chat: conferma email non creata:', error))
        if (drafts.size > MAX_EMAILS_PER_CARD) reply = `${reply}\n\nNella scheda ci sono le prime ${MAX_EMAILS_PER_CARD} email: le altre ${drafts.size - MAX_EMAILS_PER_CARD} restano nelle bozze.`
      }
      return finish(reply)
    }

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
          // Email messa dalla super chat: non collega conversazioni in automatico (resta un suggerimento).
          if (updates.email) await Promise.all(ids.map((id) => noteLeadFields(id, { email: updates.email }, 'auto')))
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
          const name = last.contact_name || contactId
          const within = Date.now() - new Date(last.created_at).getTime() < 24 * 3600_000
          result = {
            ...(await queue(`Messaggio per ${name} · ${platform === 'instagram' ? 'Instagram' : 'Facebook'}`, {
              kind: 'social_message',
              platform,
              contactId,
              name,
              text: text.slice(0, 1900),
              lastIncomingAt: last.created_at,
            })),
            entro_24_ore: within,
            ...(within ? {} : { avviso: 'il suo ultimo messaggio ha più di 24 ore: Meta non permette di scriverle da qui, dillo a Luca (può scriverle dall’app)' }),
          }
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
          const ids = [...new Set(asIds(args.deviceIds) || [])].filter((id) => known.has(id)).sort()
          if (!ids.length) {
            result = { errore: 'nessun dispositivo con questi id: usa list_push_devices' }
            break
          }
          const devices = ids.map((id) => ({ id, name: known.get(id) || id }))
          result = {
            ...(await queue(`Togliere le notifiche da ${devices.map((d) => d.name).join(', ')}`.slice(0, 150), { kind: 'remove_push_devices', devices })),
            nota_dopo: 'dopo la conferma, per riattivarlo basta aprire Messaggi da quel dispositivo e attivare le notifiche',
          }
          break
        }
        case 'content_settings': {
          const [settings, state, directions] = await Promise.all([loadBlogAutoSettings(), loadBlogAutoState(), loadContentDirections()])
          const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
          result = {
            blog_automatico: settings.enabled ? 'acceso' : 'spento',
            giorni: settings.days.map((d) => dayNames[d]),
            ora: settings.time,
            condivisione: { facebook: settings.shareFacebook, instagram: settings.shareInstagram, copertina: settings.coverImage },
            ultimo: { stato: state.lastStatus, nota: state.lastNote, articolo: state.lastPost, social: state.lastFacebook, aggiornato: state.updatedAt },
            indicazioni: directions.text || '(nessuna)',
            indicazioni_aggiornate: directions.updatedAt,
          }
          break
        }
        case 'set_content_directions': {
          const mode = args.mode === 'replace' || args.mode === 'clear' ? args.mode : 'append'
          const text = asText(args.text)?.trim() || ''
          if (mode === 'clear') {
            // Cancellare non si annulla: scheda di conferma.
            result = await queue('Cancellare le indicazioni per i contenuti', { kind: 'clear_content_directions' })
            break
          }
          if (!text) {
            result = { errore: 'scrivi le indicazioni in "text"' }
            break
          }
          if (mode === 'replace') {
            // Sostituire toglie quelle di prima (non si annulla): scheda con le vecchie e le nuove.
            const previous = (await loadContentDirections()).text
            if (previous.trim()) {
              result = await queue('Sostituire le indicazioni per i contenuti', { kind: 'replace_content_directions', text: text.slice(0, 3000), previous })
              break
            }
          }
          const saved = await saveContentDirections(text, mode)
          result = { salvate: true, indicazioni: saved.text || '(nessuna)', nota: 'valgono dal prossimo articolo e carosello' }
          break
        }
        case 'update_blog_schedule': {
          const patch: Partial<BlogAutoSettings> = {}
          if (typeof args.enabled === 'boolean') patch.enabled = args.enabled
          if (Array.isArray(args.days)) patch.days = [...new Set(args.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
          if (typeof args.time === 'string' && /^\d{1,2}:\d{2}$/.test(args.time.trim())) patch.time = args.time.trim().padStart(5, '0')
          if (typeof args.shareFacebook === 'boolean') patch.shareFacebook = args.shareFacebook
          if (typeof args.shareInstagram === 'boolean') patch.shareInstagram = args.shareInstagram
          if (!Object.keys(patch).length) {
            result = { errore: 'nessun campo valido da cambiare (days: numeri da 0 a 6, time: "HH:MM")' }
            break
          }
          // Il blog automatico pubblica da solo sui social: ogni cambio passa dalla scheda di conferma.
          result = await queue('Cambiare il blog automatico', { kind: 'blog_schedule', patch })
          break
        }
        case 'create_carousel': {
          // Rifatto da un carosello gia' creato (es. uno di prima, per poterlo correggere slide per slide).
          const fromId = asText(args.from_draft)?.trim()
          const from = fromId ? await loadPostDraft(fromId) : null
          if (fromId && !from) {
            result = { errore: 'carosello da rifare non trovato: usa recent_posts' }
            break
          }
          const fromSlides = from?.slides ?? []
          const brief = asText(args.brief)?.trim() || (from ? [from.title, ...fromSlides.map((x) => `${x.title}: ${x.text}`)].join('\n') : message)
          const given = Array.isArray(args.images) ? args.images.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')) : []
          const images = given.length ? given : from ? (from.photos ?? []) : attachedImages
          reportStatus(images.length ? `Creo il carosello con ${images.length === 1 ? 'la tua immagine' : `le tue ${images.length} immagini`}…` : 'Creo il carosello…')
          // "tre slide" = 3 immagini in tutto (copertina e slide finale comprese).
          const total = asCount(args.slide_count) ?? slideCountFrom(message) ?? from?.urls.length
          const givenSlides = Array.isArray(args.slides)
            ? (args.slides as { title?: unknown; text?: unknown }[]).map((x) => ({ title: String(x.title || ''), text: String(x.text || '') })).filter((x) => x.title)
            : []
          const draft = await createPostDraft({
            brief,
            total,
            photos: images,
            imageNotes: asText(args.image_notes) || (from ? undefined : attachedNotes),
            onlyMyImages: args.only_my_images === true,
            hook: asText(args.hook) || from?.hook,
            slides: givenSlides.length ? givenSlides : fromSlides.length ? fromSlides : undefined,
            caption: from?.caption,
            facebook: from?.facebook,
          })
          actions.push(postPreview(draft))
          result = {
            creato: true,
            draftId: draft.id,
            slide: draft.urls.length,
            ...(total ? { slide_chieste: total } : {}),
            gancio: draft.hook,
            titoli: draft.slides.map((x) => x.title),
            didascalia: draft.caption.slice(0, 400),
            ...(draft.unusedPhotos > 0 ? { foto_non_usate: draft.unusedPhotos, nota_foto: 'con questo numero di slide alcune foto di Luca non ci stanno: diglielo' } : {}),
            nota: 'l’anteprima con il pulsante Pubblica compare a Luca sotto la tua risposta: non è ancora pubblicato. Luca può toccare le slide per correggerle, spostarle o toglierle',
          }
          break
        }
        case 'publish_carousel': {
          if (!who.admin) {
            result = { errore: ONLY_ADMIN }
            break
          }
          const id = asText(args.draftId) || ''
          const draft = await loadPostDraft(id)
          if (!draft) {
            result = { errore: 'bozza non trovata: crea prima il carosello con create_carousel' }
            break
          }
          const wanted = (Array.isArray(args.platforms) ? args.platforms : ['instagram', 'facebook']).filter((p): p is 'instagram' | 'facebook' => p === 'instagram' || p === 'facebook')
          // Solo dove non e' gia' uscito (come il pulsante Pubblica).
          const platforms = (wanted.length ? wanted : (['instagram', 'facebook'] as const)).filter((p) => !draft.results?.[p])
          if (!platforms.length) {
            result = { errore: 'questo carosello è già pubblicato dove chiesto: niente da fare' }
            break
          }
          // Esce esattamente quello che la scheda mostra: slide, didascalia e testo Facebook di adesso.
          const caption = asText(args.caption)?.trim().slice(0, 2200) || draft.caption
          result = await queue(`Pubblicare «${draft.title}»`.slice(0, 150), {
            kind: 'publish_carousel',
            draftId: draft.id,
            title: draft.title,
            platforms: [...platforms],
            base: draft.urls,
            caption,
            ...(draft.facebook ? { facebook: draft.facebook } : {}),
          })
          break
        }
        case 'recent_posts': {
          const list = await recentPostDrafts(Math.min(20, asNumber(args.limit) || 10))
          result = {
            caroselli: list.map((d) => ({
              draftId: d.id,
              titolo: d.title,
              creato: d.createdAt,
              stato: d.status,
              instagram: d.results?.instagram ? 'pubblicato' : 'non pubblicato',
              facebook: d.results?.facebook ? 'pubblicato' : 'non pubblicato',
              errori: d.results?.errors?.length ? d.results.errors : undefined,
              slide: d.urls.length,
            })),
          }
          break
        }
        case 'show_post': {
          const draft = await loadPostDraft(asText(args.draftId) || '')
          if (!draft) {
            result = { errore: 'carosello non trovato: usa recent_posts' }
            break
          }
          const missing = (['instagram', 'facebook'] as const).filter((p) => !draft.results?.[p])
          actions.push({ ...postPreview(draft), ...(missing.length ? { platforms: [...missing] } : {}) })
          result = { mostrato: true, da_pubblicare_su: missing, slide_modificabili: isEditable(draft) }
          break
        }
        case 'edit_carousel':
        case 'arrange_carousel': {
          if (!who.admin) {
            result = { errore: ONLY_ADMIN }
            break
          }
          const draft = await targetDraft(asText(args.draftId))
          if (!draft) {
            result = { errore: 'carosello non trovato: usa recent_posts' }
            break
          }
          const numbers = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [])
          reportStatus(call.tool === 'edit_carousel' ? 'Correggo le slide scelte…' : 'Sistemo le slide…')
          try {
            const outcome =
              call.tool === 'edit_carousel'
                ? await editSlidesAI(draft.id, draft.urls, numbers(args.slides), asText(args.instruction) || message)
                : await arrangeSlides(draft.id, draft.urls, numbers(args.order))
            if (outcome.changed) actions.push(postPreview(outcome.draft))
            result = {
              fatto: outcome.changed ? outcome.done : ['niente da cambiare'],
              draftId: outcome.draft.id,
              slide: (carouselOutline(outcome.draft) || []).map((x) => ({ n: x.n, tipo: x.kind, testo: x.hook || x.title })),
              nota: outcome.changed ? 'anteprima aggiornata mostrata a Luca, non ancora pubblicata' : undefined,
            }
          } catch (error) {
            result = { errore: error instanceof DraftConflictError ? 'il carosello è appena cambiato: riprova' : error instanceof Error ? error.message : 'modifica non riuscita' }
          }
          break
        }
        case 'carousel_from_blog': {
          reportStatus('Rifaccio il carosello dell’articolo, con immagini nuove…')
          // "con 3 slide" = 3 immagini in tutto, come create_carousel.
          const draft = await carouselDraftFromBlogPost(asText(args.slug), asCount(args.slide_count) ?? slideCountFrom(message))
          actions.push(postPreview(draft))
          result = { creato: true, draftId: draft.id, slide: draft.urls.length, gancio: draft.hook, nota: 'anteprima con Pubblica mostrata a Luca, non ancora pubblicato' }
          break
        }
        case 'publish_blog_now': {
          // Sul sito vero si chiama sempre il dominio; nelle anteprime la versione stessa.
          const origin = process.env.VERCEL_ENV === 'production' ? SITE_URL : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
          result = await queue('Pubblicare subito un articolo del blog', { kind: 'publish_blog_now', origin })
          break
        }
        case 'create_document': {
          if (!who.admin) {
            result = { errore: ONLY_ADMIN_DOCS }
            break
          }
          const kind = asDocKind(args.kind)
          // "about" come oggetto, come testo ("Giusy") o con i campi messi fuori: la persona non deve perdersi.
          const about: Record<string, unknown> =
            args.about && typeof args.about === 'object' ? (args.about as Record<string, unknown>) : { contact: asText(args.about) ?? asText(args.contact), platform: args.platform }
          const contact = asText(about.contact) || asText(about.contactId) || asText(about.username) || asText(about.email) || asText(about.name)
          const instructions = asText(args.instructions)?.trim() || message
          let transcript: Transcript | null = null
          if (contact?.trim()) {
            reportStatus(`Cerco la conversazione con ${contact.trim().slice(0, 40)}…`)
            const found = await resolveConversation(asText(about.platform), contact)
            if (found.error) {
              result = { errore: found.error }
              break
            }
            if (found.options) {
              result = {
                piu_conversazioni: found.options.map((o) => ({ platform: o.platform, contactId: o.contactId, nome: o.name || o.contactId, ultimo_messaggio: o.last, messaggi: o.messages })),
                nota: 'più conversazioni corrispondono: chiedi a Luca quale (nome e canale), poi richiama create_document con about.platform e about.contact = contactId',
              }
              break
            }
            transcript = found.match ? await loadTranscript(found.match.platform, found.match.contactId) : null
            if (!transcript) {
              result = { errore: 'la conversazione trovata non ha messaggi leggibili (forse eliminata dalla casella): chiedi a Luca come procedere' }
              break
            }
          }
          reportStatus(transcript ? `Scrivo il documento dalla chat con ${transcript.source.name}…` : 'Scrivo il documento…')
          const knowledge = await loadKnowledge().catch(() => '')
          const written = await writeDocument({ kind, title: asText(args.title)?.slice(0, 140), instructions: withLuca(instructions), transcript, knowledge })
          const saved = await saveNewDocument({ kind, doc: written.doc, by: who.email ?? null, basedOn: transcript?.source ?? null, note: instructions, fromChat: written.fromChat })
          actions.push(documentCard(saved.record, saved.version))
          docsTouched.push(saved.version)
          result = {
            creato: true,
            document_id: saved.record.id,
            versione: saved.version.v,
            tipo: DOC_KIND_LABEL[kind],
            titolo: saved.version.doc.title,
            pagine: saved.version.pages,
            basato_su: transcript ? describeSource(transcript.source) : 'nessuna conversazione (solo la richiesta di Luca)',
            ...(transcript?.omitted ? { nota_conversazione: `conversazione molto lunga: ${transcript.omitted} messaggi intermedi non letti` } : {}),
            sezioni: saved.version.doc.sections.map((x) => x.heading).filter(Boolean).slice(0, 20),
            punti_dalla_chat: written.fromChat,
            da_completare: saved.version.placeholders,
            nota: `la scheda con «Apri PDF» e «Scarica» compare a Luca sotto la tua risposta. Rispondi in breve: cosa contiene, su quale conversazione si basa, i punti DA COMPLETARE, e una volta: "${DOC_DISCLAIMER}"`,
          }
          break
        }
        case 'update_document': {
          if (!who.admin) {
            result = { errore: ONLY_ADMIN_DOCS }
            break
          }
          const record = await pickDocument(asText(args.document_id))
          if (!record) {
            result = { errore: 'documento non trovato: usa list_documents (o creane uno con create_document)' }
            break
          }
          const instructions = asText(args.instructions)?.trim() || message
          const current = latestVersion(record)
          reportStatus(`Aggiorno «${current.doc.title.slice(0, 50)}»…`)
          const transcript = record.basedOn ? await loadTranscript(record.basedOn.platform, record.basedOn.contactId, 15_000) : null
          const knowledge = await loadKnowledge().catch(() => '')
          const revised = await reviseDocument({ kind: record.kind, current: current.doc, instructions: withLuca(instructions), transcript, knowledge })
          const saved = await addDocumentVersion(record.id, revised.doc, who.email ?? null, instructions, revised.fromChat)
          if (!saved) {
            result = { errore: 'documento non trovato mentre lo salvavo: riprova' }
            break
          }
          actions.push(documentCard(saved.record, saved.version))
          docsTouched.push(saved.version)
          result = {
            aggiornato: true,
            document_id: saved.record.id,
            versione: saved.version.v,
            versioni_precedenti: saved.record.versions.filter((v) => v.v !== saved.version.v).map((v) => v.v),
            titolo: saved.version.doc.title,
            pagine: saved.version.pages,
            da_completare: saved.version.placeholders,
            nota: `nuova versione mostrata a Luca (le precedenti restano scaricabili dalla scheda). Di' in breve cosa è cambiato, i punti DA COMPLETARE e una volta: "${DOC_DISCLAIMER}"`,
          }
          break
        }
        case 'list_documents': {
          const list = await recentDocuments(10)
          result = { documenti: list.map((d) => ({ document_id: d.id, titolo: d.title, tipo: DOC_KIND_LABEL[d.kind] || d.kind, aggiornato: d.at })) }
          break
        }
        case 'send_document': {
          if (!who.admin) {
            result = { errore: ONLY_ADMIN_DOCS }
            break
          }
          const record = await pickDocument(asText(args.document_id))
          const version = record ? findVersion(record, asCount(args.version) ?? null) : null
          if (!record || !version) {
            result = { errore: 'documento o versione non trovati: usa list_documents' }
            break
          }
          const source = record.basedOn
          const given = asText(args.to)?.trim().toLowerCase()
          if (given && !EMAIL_RE.test(given)) {
            result = { errore: 'indirizzo email non valido' }
            break
          }
          const to = given || (source?.platform === 'email' ? source.contactId.toLowerCase() : '')
          if (!to) {
            const channel = source ? PLATFORM_LABEL[source.platform] || source.platform : 'questo canale'
            result = {
              errore: `su ${channel} non posso allegare file da qui`,
              nota: 'spiega a Luca che può aprire il PDF con «Apri PDF» o scaricarlo con «Scarica» e mandarlo dall’app; se ha un’email della persona posso mandarlo io per email (sempre con la sua conferma sulla scheda)',
            }
            break
          }
          // Stessa conversazione email del documento: si risponde nel thread.
          let threadId: string | null = null
          if (source?.platform === 'email' && source.contactId.toLowerCase() === to) {
            const { data: last } = await supabaseAdmin
              .from('social_messages')
              .select('channel_account_id')
              .eq('platform', 'email')
              .eq('contact_id', source.contactId)
              .not('channel_account_id', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            threadId = last?.channel_account_id ?? null
          }
          const name = source?.name || to
          const title = version.doc.title
          // Risposta nel thread: oggetto ("Re: …") e indirizzo veri, da mostrare sulla scheda.
          const reply = threadId ? await previewThreadReply(threadId, to).catch(() => null) : null
          const text =
            asText(args.text)?.trim().slice(0, 6000) ||
            `Ciao ${name.split(/\s+/)[0]},\n\nti mando in allegato "${title}" da leggere con calma. Se va bene o vuoi cambiare qualcosa, scrivimi pure.\n\nA presto,\nLuca Corrao\nFacevoice AI · www.facevoice.ai`
          result = await queue(`Documento per ${name} · Email`.slice(0, 150), {
            kind: 'send_document',
            docId: record.id,
            version: version.v,
            title,
            filename: pdfFilename(title),
            pages: version.pages,
            to,
            name,
            threadId,
            subject: reply?.subject || title,
            ...(reply ? { recipient: reply.recipient } : {}),
            text,
          })
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

  function finish(reply: string): AssistantResult {
    // honest() indica anche la scheda ancora aperta quando Luca scrive "sì, invia" in chat.
    const text = honest(reply)
    return {
      reply: text,
      drafts: [...changed.values()],
      removeDrafts: [...removed],
      refresh,
      // Niente piu' conferma del browser: le email partono dalla scheda di conferma.
      confirmSend: false,
      more,
      focus,
      actions,
    }
  }

  /**
   * Risposta onesta: con azioni appena messe in attesa non si dice mai "inviato/pubblicato"
   * (partono solo con il clic), e dopo un documento c'e' sempre l'avviso e l'elenco dei dati da completare.
   */
  function honest(reply: string): string {
    let text = reply
    // Frasi che dicono "inviato / pubblicato / partito" per un'azione ancora in attesa del clic:
    // si tolgono (solo quelle: le frasi vere su azioni FATTE prima restano).
    const pendingIds = new Set(queued.map((a) => a.id))
    const stillOpen = openBefore.filter((a) => !pendingIds.has(a.id))
    const queuedWords = new Set(queued.flatMap((a) => [...actionWords(a)]))
    const openWords = new Set(stillOpen.flatMap((a) => [...actionWords(a)]))
    const doneWords = new Set(waiting.filter((a) => stateOf(a) === 'done' && !pendingIds.has(a.id)).flatMap((a) => [...actionWords(a)]))
    const deletions = [...queued, ...stillOpen].some((a) => DELETE_KINDS.includes(a.payload.kind))
    const falseClaim = (sentence: string) => {
      if (!claimsDone(sentence, deletions)) return false
      const past = PAST_TIME.test(sentence)
      const aboutDone = mentions(sentence, doneWords)
      // Nomina l'azione in attesa: falsa, salvo che parli chiaramente di quella fatta prima (ieri…).
      if (mentions(sentence, queuedWords) || mentions(sentence, openWords)) return !(past && aboutDone)
      // Senza nome: con un'azione appena preparata vale per quella, salvo che parli di un'azione fatta prima.
      return queued.length > 0 && !aboutDone && !past
    }
    let dropped = false
    if (queued.length || stillOpen.length) {
      const sentences = text.match(/[^.!?…\n]+[.!?…]*[^\S\n]*|\n+/g) || []
      const kept = sentences.filter((s) => {
        if (!falseClaim(s)) return true
        dropped = true
        return false
      })
      // Con una frase falsa tolta, anche il "Fatto!" da solo che la accompagna.
      if (dropped) text = kept.filter((s) => !/^\s*(?:ecco\s+)?fatt[oaie]\s*[!.:…]*\s*$/iu.test(s)).join('').replace(/\n{3,}/g, '\n\n').trim()
    }
    if (queued.length) {
      const titles = queued.map((a) => a.title).join('; ')
      const label = cardFor(queued[0]).confirmLabel
      if (dropped) {
        text = [`Ho preparato: ${titles}. Non è ancora partito niente: controlla la scheda qui sotto e premi «${label}» per procedere, oppure «Scarta».`, text].filter(Boolean).join('\n\n')
      } else if (!/accetta|conferma|pubblica|pulsante|scheda|scarta/i.test(text)) {
        text = `${text}\n\nNon è ancora partito niente: parte solo quando premi «${label}» sulla scheda qui sotto.`.trim()
      }
    }
    if (stillOpen.length && !queued.length && (dropped || typedYes)) {
      const open = stillOpen[0]
      // Scheda già nella chat recente (con il testo eventualmente corretto da Luca): si indica
      // quella; altrimenti torna sotto la risposta, cosi' il pulsante e' li'.
      const shown = history.some((t) => t.text.includes(open.id))
      if (!shown && !actions.some((a) => a.kind === 'confirm')) actions.push(cardFor(open))
      if (dropped || !/pulsante|scheda|accetta|conferma/i.test(text)) {
        const lead = typedYes ? 'Da qui non parte niente' : 'Non è ancora partito niente'
        const pointer = `${lead}: per farlo partire premi «${cardFor(open).confirmLabel}» sulla scheda «${open.title}» (${shown ? 'la trovi più su nella chat' : 'la trovi qui sotto'}), oppure «Scarta».`
        text = [text, pointer].filter(Boolean).join('\n\n')
      }
    }
    if (docsTouched.length) {
      if (!/avvocato/i.test(text)) text = `${text}\n\n${DOC_DISCLAIMER}`.trim()
      const missing = docsTouched[docsTouched.length - 1].placeholders
      if (missing.length && !/da completare/i.test(text)) text = `${text}\n\nDa completare: ${missing.slice(0, 12).join('; ')}.`
    }
    return text
  }
}
