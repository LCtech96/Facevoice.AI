import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
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

// Agente della Ricerca clienti. Riceve una richiesta in linguaggio naturale e
// la porta a termine usando degli strumenti (cercare, analizzare, preparare
// email, riscrivere una bozza, aggiornare schede), anche in piu' passaggi.
// Le email vere partono solo dal browser, dopo conferma di Luca.

export const BATCH_LIMIT = 25
const MAX_STEPS = 6
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

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R | null>, size = 4): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.all(items.slice(i, i + size).map((item) => fn(item).catch(() => null)))
    for (const r of results) if (r) out.push(r)
  }
  return out
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
    sito: Boolean(lead.website),
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
  const result = await callGeminiWithFallback([{ role: 'user', content: user }], GEMINI_DEFAULT_MODEL, system, {
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
async function prepareFirst(args: { ids?: string[]; filter?: string; instructions?: string; limit?: number }) {
  const limit = Math.min(BATCH_LIMIT, Math.max(1, args.limit || BATCH_LIMIT))
  const pool = (await loadLeads(args.ids)).filter(
    (l) => l.status === 'new' && !l.contacted_at && (args.ids?.length ? true : matchesFilter(l, args.filter))
  )
  const targets = pool.slice(0, limit)
  const extra = args.instructions?.trim()
  const noEmail: string[] = []

  const drafts = await inBatches(targets, async (lead) => {
    let ready = lead
    if (!ready.analyzed_at || !ready.email) {
      // Leggere il sito serve a trovare l'email e i dettagli veri per complimento e punto debole.
      if (!ready.analyzed_at) ready = await analyzeLead(lead)
      if (!ready.email) {
        noEmail.push(ready.name)
        return null
      }
      if (!extra && ready.email_body) {
        return { leadId: ready.id, name: ready.name, email: ready.email, kind: 'first' as const, subject: ready.email_subject || '', body: ready.email_body }
      }
    }
    return firstEmail(ready, extra)
  })

  return {
    drafts,
    result: {
      bozze_preparate: drafts.length,
      senza_email_trovata: noEmail,
      rimasti_da_fare: Math.max(0, pool.length - targets.length),
    },
  }
}

const FOLLOWUP_RULES = `Scrivi una breve email di FOLLOW-UP, come la scriverebbe Luca a mano, che risponde nello stesso thread alla prima email (te la passo sotto). Regole:
- Dai del TU, tono amichevole, naturale e rispettoso; mai insistente, mai colpevolizzante ("non hai risposto…"), mai frasi da marketing.
- 40-80 parole, paragrafi brevi, niente elenchi, niente prezzi.
- Apri con un saluto leggero e un richiamo naturale alla mail precedente (es. "Ciao! Ti riscrivo al volo perché immagino che tra mille cose la mia mail ti sia sfuggita").
- Aggiungi UN elemento nuovo e utile legato al loro punto debole (un'idea concreta, un esempio), non ripetere la prima email.
- Chiudi portando alla chiamata su WhatsApp, es. "Se ti va, ci sentiamo dieci minuti su WhatsApp: scrivimi al ${WHATSAPP_DISPLAY} e ti chiamo io."
- Firma: "A presto,\\nLuca Corrao\\nFacevoice AI · www.facevoice.ai\\nWhatsApp ${WHATSAPP_DISPLAY}"
- Niente P.S. e nessuna frase tipo "se non ti interessa…".
- Oggetto: lo stesso della prima email preceduto da "Re: ".`

async function prepareFollowups(args: { ids?: string[]; filter?: string; instructions?: string; days?: number; limit?: number }) {
  const days = Math.max(0, args.days ?? DEFAULT_FOLLOWUP_DAYS)
  const before = Date.now() - days * 86_400_000
  const limit = Math.min(BATCH_LIMIT, Math.max(1, args.limit || BATCH_LIMIT))
  const pool = (await loadLeads(args.ids)).filter(
    (l) =>
      l.status === 'contacted' &&
      l.email &&
      l.contacted_at &&
      new Date(l.contacted_at).getTime() <= before &&
      (args.ids?.length ? true : matchesFilter(l, args.filter))
  )
  const extra = args.instructions?.trim()

  const drafts = await inBatches(pool.slice(0, limit), async (lead) => {
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

  return { drafts, result: { bozze_preparate: drafts.length, giorni_minimi: days, in_attesa_totali: pool.length } }
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

// ---------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------

const AGENT_PROMPT = `Sei l'assistente operativo di Luca nella pagina "Ricerca clienti" di Facevoice AI. Luca ti chiede cose in linguaggio naturale e tu le porti a termine usando gli strumenti, anche in più passaggi. Sii proattivo: se per fare una cosa serve prima un'altra (es. analizzare i siti per trovare le email), falla senza chiedere.

A ogni passo rispondi SOLO con un JSON, in uno di questi due formati:
{"tool": "nome_strumento", "args": {...}}
{"reply": "risposta finale breve per Luca, in italiano", "confirm_send": false}

Strumenti:
- "stats": {} → numeri della lista.
- "list_leads": {"status": "new|contacted|replied|client|discarded|do_not_contact|all", "filter": "testo opzionale", "only_with_email": false, "limit": 30} → elenco schede (id, nome, stato, email...).
- "search_places": {"query": "ristoranti Catania", "max": 20} → cerca su Google Maps e aggiunge alla lista (max 20, 40 o 60).
- "analyze": {"ids": [...] oppure omesso, "limit": 25} → legge i siti delle schede nuove non analizzate: trova email e social, dà il punteggio.
- "prepare_first_emails": {"ids": [...] opzionale, "filter": "testo opzionale", "instructions": "indicazioni di Luca", "limit": 25} → prepara le PRIME email per chi non è ancora stato contattato (analizza da solo chi non è analizzato). Le bozze compaiono a Luca per il controllo.
- "prepare_followups": {"ids": [...] opzionale, "filter": "", "days": 3, "instructions": "", "limit": 25} → prepara follow-up per chi è stato contattato e non ha risposto (days = giorni minimi dal primo contatto; usa 0 se Luca dice "a tutti" o "anche di oggi").
- "revise_draft": {"leadId": "...", "instructions": "cosa cambiare"} → riscrive una bozza già preparata (vedi l'elenco delle bozze aperte). Per riscriverne più di una, chiamalo più volte o usa "revise_all".
- "revise_all": {"instructions": "cosa cambiare"} → riscrive tutte le bozze aperte con la stessa indicazione.
- "remove_drafts": {"leadIds": [...]} → toglie bozze dalla lista.
- "update_leads": {"ids": [...], "status": "...", "notes": "...", "email": "..."} → aggiorna schede (stato, note, email corretta).

Invio: tu NON invii email. Se Luca chiede di inviare/mandare le bozze aperte, rispondi con {"reply": "...", "confirm_send": true}: comparirà a Luca la conferma di invio.

Regole: non inventare id (usa list_leads), al massimo ${MAX_STEPS} passi, risposta finale breve con cosa hai fatto e cosa resta (es. contatti senza email: suggerisci di scrivergli sui social o chiamarli).`

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
  if (!getGeminiApiKey()) return { reply: 'Manca GEMINI_API_KEY: l’assistente non può lavorare.' }

  const drafts = new Map(openDrafts.map((d) => [d.leadId, d]))
  const changed = new Map<string, Draft>()
  const removed = new Set<string>()
  let refresh = false

  const context = [
    `Riepilogo: ${JSON.stringify(await stats())}`,
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

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await callGeminiWithFallback(transcript, GEMINI_DEFAULT_MODEL, AGENT_PROMPT, {
      temperature: 0.2,
      maxOutputTokens: 800,
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
          const list = (await loadLeads()).filter(
            (l) =>
              (status === 'all' || l.status === status) &&
              matchesFilter(l, asText(args.filter)) &&
              (!args.only_with_email || Boolean(l.email))
          )
          result = { totale: list.length, schede: list.slice(0, limit).map(compact) }
          break
        }
        case 'search_places': {
          const query = asText(args.query)?.trim() || ''
          if (query.length < 3) {
            result = { errore: 'query mancante' }
            break
          }
          result = await searchPlaces(query, Math.max(1, Math.min(MAX_RESULTS, asNumber(args.max) || 20)))
          refresh = true
          break
        }
        case 'analyze': {
          const ids = asIds(args.ids)
          const limit = Math.min(BATCH_LIMIT, asNumber(args.limit) || BATCH_LIMIT)
          const todo = (await loadLeads(ids)).filter((l) => (ids?.length ? true : l.status === 'new' && !l.analyzed_at)).slice(0, limit)
          const done = await inBatches(todo, (lead) => analyzeLead(lead))
          result = {
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
            instructions: asText(args.instructions),
            limit: asNumber(args.limit),
          })
          for (const d of out.drafts) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          result = out.result
          refresh = true
          break
        }
        case 'prepare_followups': {
          const out = await prepareFollowups({
            ids: asIds(args.ids),
            filter: asText(args.filter),
            instructions: asText(args.instructions),
            days: asNumber(args.days),
            limit: asNumber(args.limit),
          })
          for (const d of out.drafts) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          result = out.result
          break
        }
        case 'revise_draft': {
          const draft = drafts.get(asText(args.leadId) || '')
          if (!draft) {
            result = { errore: 'bozza non trovata: usa un leadId dell’elenco delle bozze aperte' }
            break
          }
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
          const revised = await inBatches([...drafts.values()], (d) => reviseDraft(d, instructions))
          for (const d of revised) {
            drafts.set(d.leadId, d)
            changed.set(d.leadId, d)
          }
          result = { riscritte: revised.length }
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
          const { error } = await supabaseAdmin.from('leads').update(updates).in('id', ids)
          result = error ? { errore: error.message } : { aggiornate: ids.length }
          refresh = true
          break
        }
        default:
          result = { errore: `strumento sconosciuto: ${call.tool}` }
      }
    } catch (error) {
      result = { errore: error instanceof Error ? error.message : 'errore' }
    }

    transcript.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args }) })
    transcript.push({ role: 'user', content: `Risultato di ${call.tool}: ${JSON.stringify(result).slice(0, 6000)}` })
  }

  return finish('Ho fatto quello che potevo in questo giro: dimmi se continuo.')

  function finish(reply: string, confirmSend = false): AssistantResult {
    return {
      reply,
      drafts: [...changed.values()],
      removeDrafts: [...removed],
      refresh,
      confirmSend: confirmSend && drafts.size > 0,
    }
  }
}
