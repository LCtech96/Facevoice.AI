import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { DAILY_EMAIL_LIMIT, FIRST_EMAIL_RULES, MAX_RESULTS, WHATSAPP_DISPLAY, analyzeLead, searchPlaces, type Lead } from '@/lib/leads'

// Assistente della Ricerca clienti: capisce una richiesta in linguaggio
// naturale e la trasforma in un'azione precisa. Le email non partono mai da
// sole: l'assistente prepara le bozze, Luca le controlla e preme "Invia".

export const BATCH_LIMIT = 20
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
  analyzeIds?: string[]
  refresh?: boolean
}

type Plan = {
  action: 'draft_first' | 'draft_followup' | 'search' | 'analyze' | 'answer'
  instructions?: string
  query?: string
  max?: number
  days?: number
  limit?: number
  filter?: string
  answer?: string
}

const PLANNER_PROMPT = `Sei l'assistente della pagina "Ricerca clienti" di Facevoice AI. Luca ti scrive cosa vuole fare con i contatti (attività trovate su Google Maps). Trasforma la richiesta in UNA azione, rispondendo SOLO con JSON valido:

{"action": "...", "instructions": "...", "query": "...", "max": 20, "days": 3, "limit": 20, "filter": "...", "answer": "..."}

Azioni possibili:
- "draft_first": preparare la PRIMA email per i contatti mai contattati che hanno un'email (es. "scrivi a tutti quelli a cui non abbiamo ancora scritto"). "instructions": eventuali indicazioni di Luca su tono o contenuto (stringa vuota se nessuna). "filter": parola per restringere a una ricerca/categoria/città se Luca la indica (es. "ristoranti roma"), altrimenti "".
- "draft_followup": preparare una email di FOLLOW-UP per chi ha già ricevuto la prima email e non ha risposto (es. "scrivi un follow-up a chi non ha risposto"). "days": dopo quanti giorni dal primo contatto (default 3; se Luca dice "a tutti" usa 0). "instructions" e "filter" come sopra.
- "search": cercare nuove attività su Google Maps (es. "trovami 40 dentisti a Palermo"). "query": testo da cercare, "max": numero (20, 40 o 60).
- "analyze": analizzare i siti dei contatti nuovi non ancora analizzati.
- "answer": domande o richieste che non richiedono azioni (statistiche, consigli). "answer": la risposta breve in italiano, usando i dati del riepilogo.

"limit": quanti contatti al massimo (default 20, massimo 20). Rispondi solo con il JSON.`

function parsePlan(raw: string): Plan | null {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    const plan = json ? (JSON.parse(json) as Plan) : null
    return plan?.action ? plan : null
  } catch {
    return null
  }
}

async function summary() {
  const { data } = await supabaseAdmin.from('leads').select('status, email, analyzed_at, contacted_at')
  const leads = data || []
  const count = (fn: (l: (typeof leads)[number]) => boolean) => leads.filter(fn).length
  return {
    totale: leads.length,
    da_contattare_con_email: count((l) => l.status === 'new' && !l.contacted_at && Boolean(l.email)),
    da_contattare_senza_email: count((l) => l.status === 'new' && !l.email),
    non_analizzati: count((l) => !l.analyzed_at && l.status === 'new'),
    contattati_senza_risposta: count((l) => l.status === 'contacted'),
    hanno_risposto: count((l) => l.status === 'replied'),
    clienti: count((l) => l.status === 'client'),
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

/** Esegue a gruppi di 4 per non far scadere la richiesta. */
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += 4) {
    const results = await Promise.all(items.slice(i, i + 4).map((item) => fn(item).catch(() => null)))
    for (const r of results) if (r) out.push(r)
  }
  return out
}

function matchesFilter(lead: Lead, filter?: string) {
  const words = (filter || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  if (!words.length) return true
  const haystack = `${lead.name} ${lead.search_query || ''} ${lead.address || ''}`.toLowerCase()
  return words.every((w) => haystack.includes(w))
}

async function draftFirst(plan: Plan): Promise<AssistantResult> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .is('contacted_at', null)
    .not('email', 'is', null)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(200)
  const limit = Math.min(BATCH_LIMIT, Math.max(1, plan.limit || BATCH_LIMIT))
  const targets = ((data || []) as Lead[]).filter((l) => matchesFilter(l, plan.filter)).slice(0, limit)
  if (!targets.length) return { reply: 'Non ci sono contatti da scrivere: nessuno ha un’email e non è ancora stato contattato.' }

  const extra = plan.instructions?.trim()
  const drafts = await inBatches(targets, async (lead) => {
    // Mai analizzato: prima si legge il sito, cosi' complimento e punto debole sono veri.
    const ready = lead.analyzed_at ? lead : await analyzeLead(lead)
    if (!extra && ready.email_body && ready !== lead) {
      return { leadId: ready.id, name: ready.name, email: ready.email!, kind: 'first' as const, subject: ready.email_subject || '', body: ready.email_body }
    }
    const generated = await generate(
      `Sei l'assistente commerciale di Luca Corrao (Facevoice AI). Scrivi la PRIMA email di contatto a freddo, ${FIRST_EMAIL_RULES}
${extra ? `\nIndicazioni aggiuntive di Luca (hanno la precedenza sullo stile, non sulle regole di onestà): ${extra}` : ''}

Rispondi SOLO con JSON: {"subject": "...", "body": "..."}`,
      leadFacts(ready)
    )
    if (!generated) return null
    await supabaseAdmin.from('leads').update({ email_subject: generated.subject, email_body: generated.body }).eq('id', ready.id)
    return { leadId: ready.id, name: ready.name, email: ready.email!, kind: 'first' as const, ...generated }
  })

  return {
    reply: `Ho preparato ${drafts.length} email di primo contatto. Controllale qui sotto: puoi modificarle, toglierne alcune e poi inviarle.${targets.length === limit ? ` (Massimo ${BATCH_LIMIT} alla volta.)` : ''}`,
    drafts,
    refresh: true,
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

async function draftFollowup(plan: Plan): Promise<AssistantResult> {
  const days = Math.max(0, plan.days ?? DEFAULT_FOLLOWUP_DAYS)
  const before = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('status', 'contacted')
    .not('email', 'is', null)
    .lte('contacted_at', before)
    .order('contacted_at', { ascending: true })
    .limit(200)
  const limit = Math.min(BATCH_LIMIT, Math.max(1, plan.limit || BATCH_LIMIT))
  const candidates = ((data || []) as Lead[]).filter((l) => matchesFilter(l, plan.filter))
  if (!candidates.length) {
    return {
      reply: days
        ? `Nessun contatto senza risposta da almeno ${days} giorni. Se vuoi scrivere comunque a tutti, dimmi "follow-up a tutti anche se scritti oggi".`
        : 'Nessun contatto in attesa di risposta.',
    }
  }

  const extra = plan.instructions?.trim()
  const drafts = await inBatches(candidates.slice(0, limit), async (lead) => {
    const email = lead.email!.toLowerCase()
    // Ultima email inviata a quel contatto: serve il thread Gmail per rispondere nello stesso filo.
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

  return {
    reply: `Ho preparato ${drafts.length} follow-up per chi non ha ancora risposto${days ? ` (primo contatto da almeno ${days} giorni)` : ''}. Partono come risposta nella stessa conversazione email.`,
    drafts,
  }
}

export async function runAssistant(message: string): Promise<AssistantResult> {
  if (!getGeminiApiKey()) return { reply: 'Manca GEMINI_API_KEY: l’assistente non può lavorare.' }

  const stats = await summary()
  const planned = await callGeminiWithFallback(
    [{ role: 'user', content: `Riepilogo attuale: ${JSON.stringify(stats)}\n\nRichiesta di Luca: ${message}` }],
    GEMINI_DEFAULT_MODEL,
    PLANNER_PROMPT,
    { temperature: 0.1, maxOutputTokens: 600 }
  )
  const plan = parsePlan(planned.message || '')
  if (!plan) return { reply: 'Non ho capito bene cosa fare: puoi riformulare la richiesta?' }

  switch (plan.action) {
    case 'draft_first':
      return draftFirst(plan)
    case 'draft_followup':
      return draftFollowup(plan)
    case 'search': {
      const query = (plan.query || '').trim()
      if (query.length < 3) return { reply: 'Dimmi cosa cercare, es. "ristoranti Catania".' }
      const max = Math.max(1, Math.min(MAX_RESULTS, plan.max || 20))
      const result = await searchPlaces(query, max)
      return {
        reply: `Cercato "${query}": ${result.found} attività trovate, ${result.added} nuove aggiunte alla lista. Vuoi che le analizzi?`,
        refresh: true,
      }
    }
    case 'analyze': {
      const { data } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('status', 'new')
        .is('analyzed_at', null)
        .limit(60)
      const ids = (data || []).map((l) => l.id)
      return {
        reply: ids.length ? `Analizzo ${ids.length} contatti nuovi: ci vuole qualche minuto.` : 'Sono già tutti analizzati.',
        analyzeIds: ids,
      }
    }
    default:
      return {
        reply:
          plan.answer?.trim() ||
          `Ecco la situazione: ${stats.da_contattare_con_email} da contattare con email, ${stats.contattati_senza_risposta} in attesa di risposta, ${stats.hanno_risposto} hanno risposto. Limite primi contatti: ${DAILY_EMAIL_LIMIT} al giorno.`,
      }
  }
}
