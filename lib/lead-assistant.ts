import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAIPaced, hasAIProvider, reportStatus, timeIsUp } from '@/lib/ai'
import {
  DAILY_EMAIL_LIMIT,
  FIRST_EMAIL_RULES,
  LEAD_STATUSES,
  MAX_RESULTS,
  WHATSAPP_DISPLAY,
  analyzeLead,
  searchPlaces,
  type Lead,
} from '@/lib/leads'
import { prepareOutreachReply } from '@/lib/meta/agent'
import { pollGmail } from '@/lib/gmail-poll'
import { inspectWebsite } from '@/lib/site-inspect'
import { fetchInstagramProfile } from '@/lib/meta/graph'
import { conversationKeyFor } from '@/lib/meta/identities'

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
    if (timeIsUp()) return { out, unfinished: items.length - i }
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
  return (data || []) as Lead[]
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
    hanno_risposto: n((l) => l.status === 'replied'),
    clienti: n((l) => l.status === 'client'),
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
  const generated = await generate(
    `Sei l'assistente commerciale di Luca Corrao (Facevoice AI). Scrivi la PRIMA email di contatto a freddo, ${FIRST_EMAIL_RULES}
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
      l.status === 'contacted' &&
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

/** Conversazioni Instagram/Facebook della casella (chi ci ha scritto). */
async function listConversations(platform: string | undefined, filter: string | undefined, limit: number) {
  const platforms = platform === 'instagram' || platform === 'facebook' ? [platform] : ['instagram', 'facebook']
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('platform, contact_id, contact_name, body, created_at')
    .in('platform', platforms)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(500)
  const seen = new Map<string, { platform: string; contactId: string; nome: string | null; ultimo_messaggio: string; ricevuto_il: string }>()
  for (const m of data || []) {
    const id = `${m.platform}:${m.contact_id}`
    if (seen.has(id)) continue
    seen.set(id, {
      platform: m.platform,
      contactId: m.contact_id,
      nome: m.contact_name,
      ultimo_messaggio: String(m.body || '').slice(0, 160),
      ricevuto_il: m.created_at,
    })
  }
  const words = (filter || '').toLowerCase().split(/\s+/).filter(Boolean)
  return [...seen.values()]
    .filter((c) => !words.length || words.every((w) => `${c.nome || ''} ${c.contactId}`.toLowerCase().includes(w)))
    .slice(0, limit)
}

// ---------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------

const AGENT_PROMPT = `Sei l'assistente operativo di Luca nella pagina "Ricerca clienti" di Facevoice AI. Luca ti chiede cose in linguaggio naturale e tu le porti a termine usando gli strumenti, anche in più passaggi. Sii proattivo: se per fare una cosa serve prima un'altra (es. analizzare i siti per trovare le email), falla senza chiedere.

A ogni passo rispondi SOLO con un JSON, in uno di questi due formati:
{"tool": "nome_strumento", "args": {...}}
{"reply": "risposta finale breve per Luca, in italiano", "confirm_send": false}

Strumenti:
- "stats": {} → numeri della lista.
- "list_leads": {"status": "new|contacted|replied|client|discarded|do_not_contact|all", "filter": "testo opzionale", "only_with_email": false, "recent_minutes": 120, "limit": 30, "label": "titolo breve"} → elenco schede (id, nome, stato, email...). Le schede trovate vengono anche MOSTRATE a Luca nella lista della pagina: usalo quando chiede di vedere/mostrare contatti (es. "mostrami quelli generati poco fa" → recent_minutes 180, label "Generati poco fa").
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

Strumenti di ricerca e social:
- "inspect_website": {"leadId": "..."} oppure {"url": "https://..."} → legge il sito (fino a 10 pagine): elenco pagine con titolo e contenuto, piattaforma (WordPress, Wix…), anno più recente citato e copyright (per capire se è aggiornato), funzioni presenti (prenotazioni, shop, blog, newsletter, WhatsApp, Analytics, Pixel), link social. Poi spiega tu a Luca, in parole semplici, che pagine ci sono, di cosa parlano, se il sito sembra usato attivamente e cosa manca.
- "instagram_profile": {"username": "nomeprofilo"} oppure {"leadId": "..."} → profilo Instagram pubblico (solo account business/creator): follower, seguiti, numero di post, bio, sito, ultimi 6 post con data, like e commenti (per capire se pubblicano e quanto spesso).
- "instagram_profiles": {"ids": [...] opzionale, "filter": "", "limit": 15} → lo stesso per più schede che hanno un Instagram (per domande tipo "quali hanno Instagram e quanti follower").
- "list_conversations": {"platform": "instagram|facebook|all", "filter": "nome opzionale", "limit": 20} → persone che ci hanno scritto su Instagram o Facebook (contactId, nome, ultimo messaggio e data).
- "send_social_message": {"platform": "instagram|facebook", "contactId": "...", "text": "..."} → PREPARA un messaggio Instagram/Facebook a una persona della casella (contactId da list_conversations). Non parte da solo: a Luca compare il pulsante Invia. Regola di Meta: si può scrivere solo a chi ci ha già scritto, e liberamente entro 24 ore dal suo ultimo messaggio; a nuovi profili mai contattati non si può scrivere in privato tramite API (suggerisci di commentare un loro post o scrivere dal telefono).

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

export async function runAssistant(message: string, history: Turn[], openDrafts: Draft[]): Promise<AssistantResult> {
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
    `Riepilogo: ${JSON.stringify(await stats())}`,
    replies.length ? `Risposte ricevute (aggiornate ora):\n${JSON.stringify(replies)}` : 'Risposte ricevute: nessuna.',
    drafts.size
      ? `Bozze aperte (non ancora inviate):\n${[...drafts.values()]
          .map((d) => `- leadId ${d.leadId} · ${d.name} · ${d.kind === 'first' ? 'primo contatto' : 'follow-up'} · oggetto "${d.subject}"\n  ${d.body.slice(0, 300).replace(/\n/g, ' ')}`)
          .join('\n')}`
      : 'Nessuna bozza aperta.',
    history.length ? `Conversazione recente:\n${history.slice(-6).map((t) => `${t.role === 'user' ? 'Luca' : 'Assistente'}: ${t.text}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const transcript: { role: string; content: string }[] = [{ role: 'user', content: `${context}\n\nRichiesta di Luca: ${message}` }]

  // Le parole di Luca arrivano sempre a chi scrive le email: tono e indicazioni
  // non devono perdersi nel riassunto dell'agente.
  const withLuca = (instructions?: string) =>
    [instructions?.trim(), `Richiesta di Luca, da rispettare per tono e contenuto: ${message}`].filter(Boolean).join('\n')

  for (let step = 0; step < MAX_STEPS; step++) {
    if (timeIsUp()) {
      more = true
      return finish(`Ho preparato ${changed.size} bozze finora, continuo con il resto…`)
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
                (!since || new Date(l.created_at).getTime() >= since)
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
          result = { conversazioni: await listConversations(asText(args.platform), asText(args.filter), Math.min(50, asNumber(args.limit) || 20)) }
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
        default:
          result = { errore: `strumento sconosciuto: ${call.tool}` }
      }
    } catch (error) {
      result = { errore: error instanceof Error ? error.message : 'errore' }
    }

    transcript.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args }) })
    transcript.push({ role: 'user', content: `Risultato di ${call.tool}: ${JSON.stringify(result).slice(0, 12000)}` })
  }

  return finish('Ho fatto quello che potevo in questo giro: dimmi se continuo.')

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
