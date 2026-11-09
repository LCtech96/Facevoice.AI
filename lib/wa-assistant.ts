import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  CONSENT_LABEL,
  CAMPAIGN_STATUS_LABEL,
  SKIP_LABEL,
  formatEur,
  normalizePhone,
  renderPreview,
  type Audience,
  type VariableMapping,
} from '@/lib/wa-shared'
import { addContact, consentRequestCheck, costOverview, findTemplate, listContacts, loadSettings, loadTemplates, requestConsent, tablesReady, SETUP_MESSAGE, WaError } from '@/lib/wa-store'
import { audienceLanguages, createCampaign, listCampaigns, withVersions, normalizeAudience, normalizeVariables, previewAudience, validateCampaignTemplate } from '@/lib/wa-campaigns'

// Campagne WhatsApp nella super chat: strumenti di lettura (modelli, contattabili,
// costi) e tre azioni con la scheda di conferma (lib/assistant-confirm): crea
// campagna, aggiungi contattabile, manda la richiesta di consenso. Niente parte
// senza il clic di Luca su «Conferma».

export type WaConfirmPayload =
  | {
      kind: 'wa_campaign'
      name: string
      templateName: string
      templateLanguage: string
      category: string
      variables: Record<string, VariableMapping>
      audience: Audience
      audienceLabel: string
      scheduledAt: string
      nonPromotionalAck: boolean
      eligible: number
      preview: string
    }
  | { kind: 'wa_add_contact'; phone: string; name: string | null; sector: string | null; tags: string[]; note: string }
  | { kind: 'wa_consent_request'; phone: string; name: string; text: string }

export const WA_EDITABLE_MAX = { wa_consent_request: 1000 } as const

export const WA_TOOLS_PROMPT = `Campagne WhatsApp (numero ${'+39 351 420 6353'}, pagina Campagne WhatsApp). Regole di legge: messaggi promozionali solo a chi ha dato il consenso; chi ci ha solo scritto riceve risposte, non campagne; chi scrive STOP non riceve più niente. Non inventare consensi.
- "wa_templates": {} → modelli approvati da Meta (nome, lingua, categoria MARKETING/UTILITY, testo, variabili {{1}}…).
- "wa_contacts": {"sector": "opzionale", "tag": "opzionale", "filter": "nome o numero, opzionale"} → contattabili WhatsApp: quanti, quanti con consenso ai messaggi promozionali, disiscritti, e un elenco (id, nome, numero, settore, tag, consenso, stato).
- "wa_create_campaign": {"template": "nome modello", "language": "opzionale", "sector": "opzionale", "tags": ["opzionale"], "contact_ids": ["opzionale"], "when": "ISO con fuso, es. 2026-11-10T10:00:00+01:00 (ora italiana)", "variables": {"body:1": {"type": "nome", "value": "testo di riserva se manca il nome"}, "body:2": {"type": "fisso", "value": "testo"}}, "name": "opzionale", "non_promotional": false} → PREPARA una campagna: compare la scheda di conferma con modello, anteprima del messaggio, quanti la ricevono e quando; si crea solo con «Conferma» e poi parte da sola all'ora scelta a lotti (limite giornaliero). Solo modelli APPROVED. Per UTILITY serve "non_promotional": true e solo se il messaggio non è promozionale. Prima usa wa_templates per sapere le variabili; {{1}} di solito è il nome ("type": "nome"). Calcola "when" dalla data e ora qui sopra (es. «domani alle 10»). "language" è la lingua predefinita (di solito it): se il modello ha altre lingue approvate, ogni contatto riceve da solo la versione nella sua lingua. Modello con immagine/video/PDF nell'intestazione: serve "header:media": {"type": "fisso", "value": "link https del file"}; se Luca non ha il link, digli di creare la campagna dalla pagina Campagne WhatsApp, dove carica il file.
- "wa_costs": {} → quanto si è speso su WhatsApp questo mese (stima e costo reale da Meta se disponibile), budget, costo per campagna, ultimi 7 giorni, campagne in corso.
- "wa_add_contact": {"phone": "+39…", "name": "...", "sector": "opzionale", "tags": ["opzionale"], "consent_note": "come ha dato il consenso, con le parole di Luca"} → PREPARA l'aggiunta ai contattabili: scheda di conferma, si aggiunge solo con «Conferma». Usalo SOLO se Luca dice esplicitamente di avere il consenso della persona; altrimenti chiediglielo (o proponi wa_request_consent se ci ha scritto su WhatsApp).
- "wa_request_consent": {"contact": "numero, nome o contactId WhatsApp di chi ci ha scritto", "text": "opzionale"} → PREPARA la domanda di consenso (con i bottoni «Sì, va bene» / «No, grazie») a chi ci ha scritto su WhatsApp nelle ultime 24 ore: scheda di conferma, parte solo con «Accetta e invia». Se risponde sì diventa contattabile da solo.`

export const WA_TOOLS = new Set(['wa_templates', 'wa_contacts', 'wa_create_campaign', 'wa_costs', 'wa_add_contact', 'wa_request_consent'])

const asText = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)
const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(',') : []).map((s) => s.trim()).filter(Boolean)
const romeDateTime = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Cerca chi ci ha scritto su WhatsApp: numero, contactId o nome (contattabili e casella Messaggi). */
async function resolveWhatsAppContact(query: string): Promise<{ phone: string; name: string | null }[]> {
  const phone = normalizePhone(query) || (/^\d{8,15}$/.test(query.trim()) ? normalizePhone(`+${query.trim()}`) : null)
  if (phone) return [{ phone, name: null }]
  const q = query.trim().toLowerCase()
  const contacts = (await listContacts()).filter((c) => (c.name || '').toLowerCase().includes(q))
  const out = new Map(contacts.map((c) => [c.phone, { phone: c.phone, name: c.name }]))
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('contact_id, contact_name')
    .eq('platform', 'whatsapp')
    .eq('direction', 'in')
    .ilike('contact_name', `%${q.replace(/[%_]/g, '')}%`)
    .order('created_at', { ascending: false })
    .limit(20)
  for (const m of (data || []) as { contact_id: string; contact_name: string | null }[]) {
    const p = normalizePhone(`+${m.contact_id}`)
    if (p && !out.has(p)) out.set(p, { phone: p, name: m.contact_name })
  }
  return [...out.values()].slice(0, 10)
}

/**
 * Esegue uno strumento WhatsApp della super chat. queue crea la scheda di conferma
 * (stessa funzione degli altri strumenti); admin: solo l'amministratore.
 */
export async function runWaTool(
  tool: string,
  args: Record<string, unknown>,
  ctx: { admin?: boolean; queue: (title: string, payload: WaConfirmPayload) => Promise<Record<string, unknown>> }
): Promise<unknown> {
  if (!ctx.admin) return { errore: 'solo l’amministratore può usare le campagne WhatsApp' }
  const ready = await tablesReady()
  if (!ready && tool !== 'wa_templates') return { errore: SETUP_MESSAGE }
  try {
    switch (tool) {
      case 'wa_templates': {
        const { items, syncedAt } = await loadTemplates()
        return {
          aggiornati_il: syncedAt,
          nota: items.length ? undefined : 'nessun modello letto: Luca deve premere «Aggiorna modelli» nella pagina Campagne WhatsApp (o crearli su WhatsApp Manager)',
          modelli: items
            .filter((t) => t.status === 'APPROVED')
            .map((t) => ({ nome: t.name, lingua: t.language, categoria: t.category, testo: t.body.slice(0, 400), variabili: t.variables.map((v) => v.key), non_usabile: t.unsupported || undefined })),
          non_approvati: items.filter((t) => t.status !== 'APPROVED').map((t) => `${t.name} (${t.status})`),
        }
      }
      case 'wa_contacts': {
        const all = await listContacts()
        const sector = asText(args.sector)?.toLowerCase().trim()
        const tag = asText(args.tag)?.toLowerCase().trim()
        const filter = asText(args.filter)?.toLowerCase().trim()
        const list = all.filter(
          (c) =>
            (!sector || [c.sector, c.company, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(sector)) &&
            (!tag || (c.tags || []).includes(tag)) &&
            (!filter || `${c.name || ''} ${c.phone}`.toLowerCase().includes(filter))
        )
        return {
          totale: list.length,
          con_consenso_promozionale: list.filter((c) => c.status === 'attivo' && c.consent_source !== 'ha_scritto').length,
          solo_servizio: list.filter((c) => c.status === 'attivo' && c.consent_source === 'ha_scritto').length,
          disiscritti: list.filter((c) => c.status === 'disiscritto').length,
          contatti: list.slice(0, 30).map((c) => ({ id: c.id, nome: c.name, numero: c.phone, settore: c.sector, tag: c.tags, consenso: CONSENT_LABEL[c.consent_source], stato: c.status })),
        }
      }
      case 'wa_costs': {
        const [costs, campaigns] = await Promise.all([costOverview(), listCampaigns(20)])
        return {
          mese: costs.month,
          stimato_mese: formatEur(costs.estimatedMonth),
          reale_mese: costs.realMonth === null ? `non disponibile${costs.realError ? ` (${costs.realError.slice(0, 120)})` : ''}` : formatEur(costs.realMonth),
          nota: 'la stima usa i prezzi impostati (consegnati x prezzo della categoria): da verificare sulla tabella prezzi di Meta',
          budget_mensile: costs.budget ? formatEur(costs.budget) : 'nessun limite',
          budget_usato: costs.budgetUsedPct === null ? undefined : `${costs.budgetUsedPct}%`,
          ultimi_7_giorni: costs.days.slice(-7).map((d) => `${d.date}: ${formatEur(d.estimated)}${d.real !== null ? ` (reale ${formatEur(d.real)})` : ''}`),
          per_campagna: costs.campaigns.slice(0, 10).map((c) => ({ nome: c.name, inviati: c.sent, consegnati: c.delivered, letti: c.read, risposte: c.replies, costo_stimato: formatEur(c.estimated) })),
          campagne: campaigns.slice(0, 10).map((c) => ({ nome: c.name, stato: CAMPAIGN_STATUS_LABEL[c.status], quando: romeDateTime(c.scheduled_at), destinatari: c.total, ...(c.paused_reason ? { pausa: c.paused_reason } : {}) })),
        }
      }
      case 'wa_create_campaign': {
        const templateName = asText(args.template)?.trim()
        if (!templateName) return { errore: 'serve "template": usa wa_templates' }
        const template = await findTemplate(templateName, asText(args.language))
        const variables = normalizeVariables(args.variables)
        // {{1}} senza indicazioni: il nome del contatto (con "ciao" di riserva).
        for (const v of template?.variables || []) if (!variables[v.key] && v.key !== 'header:media' && template?.variables.length === 1) variables[v.key] = { type: 'nome', value: '' }
        const nonPromotional = args.non_promotional === true
        const problem = validateCampaignTemplate(template, variables, nonPromotional)
        if (problem || !template) return { errore: problem || 'modello non trovato', variabili_del_modello: template?.variables.map((v) => v.key) }
        const when = Date.parse(asText(args.when) || '')
        if (!Number.isFinite(when) || when < Date.now() - 5 * 60_000) return { errore: 'serve "when" nel futuro, ISO con fuso orario (ora italiana)' }
        const audience = normalizeAudience({ tags: args.tags, sector: args.sector, contactIds: args.contact_ids })
        const preview = await previewAudience(template.category, audience)
        if (!preview.eligible.length) {
          return { errore: 'nessun contatto può ricevere questa campagna', trovati: preview.matched, esclusi: Object.fromEntries(Object.entries(preview.skipped).map(([k, n]) => [SKIP_LABEL[k] || k, n])) }
        }
        const audienceLabel = audience.contactIds?.length
          ? `${audience.contactIds.length} contatti scelti`
          : [audience.sector ? `settore «${audience.sector}»` : '', audience.tags?.length ? `tag ${audience.tags.join(', ')}` : ''].filter(Boolean).join(' e ') || 'tutti i contattabili'
        const sample = preview.eligible[0]
        const scheduledAt = new Date(when).toISOString()
        const name = asText(args.name)?.trim().slice(0, 120) || `${template.name} · ${audienceLabel}`.slice(0, 120)
        return {
          ...(await ctx.queue(`Campagna WhatsApp «${name}»`.slice(0, 150), {
            kind: 'wa_campaign',
            name,
            templateName: template.name,
            templateLanguage: template.language,
            category: template.category,
            variables,
            audience,
            audienceLabel,
            scheduledAt,
            nonPromotionalAck: nonPromotional,
            eligible: preview.eligible.length,
            preview: renderPreview(template, variables, { name: sample.name }),
          })),
          destinatari: preview.eligible.length,
          per_lingua: audienceLanguages((await withVersions(template, variables)).template, preview.eligible),
          esclusi: Object.fromEntries(Object.entries(preview.skipped).map(([k, n]) => [SKIP_LABEL[k] || k, n])),
        }
      }
      case 'wa_add_contact': {
        const phone = normalizePhone(asText(args.phone))
        if (!phone) return { errore: 'numero non valido: serve il numero con prefisso' }
        const note = asText(args.consent_note)?.trim()
        if (!note) return { errore: 'serve "consent_note": chiedi a Luca come ha avuto il consenso (senza consenso non si aggiunge)' }
        const name = asText(args.name)?.trim().slice(0, 200) || null
        return ctx.queue(`Aggiungere ${name || phone} ai contattabili WhatsApp`.slice(0, 150), {
          kind: 'wa_add_contact',
          phone,
          name,
          sector: asText(args.sector)?.trim().slice(0, 80) || null,
          tags: asList(args.tags).map((t) => t.toLowerCase()).slice(0, 20),
          note: note.slice(0, 500),
        })
      }
      case 'wa_request_consent': {
        const query = asText(args.contact)?.trim()
        if (!query) return { errore: 'serve "contact": numero o nome di chi ci ha scritto' }
        const found = await resolveWhatsAppContact(query)
        if (!found.length) return { errore: 'nessuno con questo nome o numero ci ha scritto su WhatsApp' }
        if (found.length > 1) return { errore: 'più persone corrispondono: chiedi a Luca quale', possibili: found.map((f) => `${f.name || '?'} · ${f.phone}`) }
        const checked = await consentRequestCheck(found[0].phone)
        if (!checked.ok) return { errore: checked.error }
        const settings = await loadSettings()
        const first = (checked.name || found[0].name || '').split(/\s+/)[0] || ''
        const text = (asText(args.text)?.trim() || settings.consentText).replace(/\{nome\}/g, first).replace(/^Ciao ,/, 'Ciao,').slice(0, 1000)
        return ctx.queue(`Richiesta di consenso WhatsApp a ${checked.name || checked.phone}`.slice(0, 150), { kind: 'wa_consent_request', phone: checked.phone, name: checked.name || checked.phone, text })
      }
    }
    return { errore: `strumento sconosciuto: ${tool}` }
  } catch (error) {
    if (error instanceof WaError) return { errore: error.message }
    throw error
  }
}

/** Contenuto della scheda di conferma per le azioni WhatsApp. */
export function waCardFor(p: WaConfirmPayload): { text?: string; editable?: boolean; maxLength?: number; lines: string[]; warning?: string; confirmLabel: string } {
  switch (p.kind) {
    case 'wa_campaign':
      return {
        text: p.preview,
        lines: [
          `Modello: ${p.templateName} (${p.templateLanguage}, ${p.category === 'MARKETING' ? 'promozionale' : 'di servizio'})`,
          `A: ${p.eligible} ${p.eligible === 1 ? 'contatto' : 'contatti'} (${p.audienceLabel}), solo attivi${p.category === 'MARKETING' ? ' e con consenso ai messaggi promozionali' : ''}`,
          `Parte ${romeDateTime(p.scheduledAt)} (ora italiana), a lotti entro il limite giornaliero`,
          'Anteprima qui sopra con il nome del primo contatto. Puoi metterla in pausa o annullarla dalla pagina Campagne WhatsApp.',
        ],
        ...(p.category === 'UTILITY' ? { warning: 'Modello di servizio: il messaggio non deve essere promozionale.' } : {}),
        confirmLabel: 'Conferma',
      }
    case 'wa_add_contact':
      return {
        lines: [`Numero: ${p.phone}`, `Nome: ${p.name || '—'}`, ...(p.sector ? [`Settore: ${p.sector}`] : []), ...(p.tags.length ? [`Tag: ${p.tags.join(', ')}`] : []), `Consenso: ${p.note}`, 'Confermando dichiari di avere il consenso di questa persona a ricevere messaggi promozionali su WhatsApp.'],
        confirmLabel: 'Conferma',
      }
    case 'wa_consent_request':
      return {
        text: p.text,
        editable: true,
        maxLength: WA_EDITABLE_MAX.wa_consent_request,
        lines: [`A: ${p.name} · ${p.phone} (WhatsApp)`, 'Con i bottoni «Sì, va bene» / «No, grazie». Se risponde sì diventa contattabile da solo; STOP lo disiscrive.'],
        confirmLabel: 'Accetta e invia',
      }
  }
}

type WaOutcome = { ok: true; outcome: string } | { ok: false; error: string; retryable: boolean }

/** Esecuzione dopo «Conferma»: condizioni ricontrollate adesso. */
export async function executeWaAction(p: WaConfirmPayload, by: string | null): Promise<WaOutcome> {
  try {
    switch (p.kind) {
      case 'wa_campaign': {
        if (Date.parse(p.scheduledAt) < Date.now() - 5 * 60_000) return { ok: false, error: 'l’ora scelta è già passata: chiedimi di nuovo la campagna con un’altra ora', retryable: false }
        const { campaign } = await createCampaign({
          name: p.name,
          templateName: p.templateName,
          templateLanguage: p.templateLanguage,
          variables: p.variables,
          audience: p.audience,
          scheduledAt: p.scheduledAt,
          nonPromotionalAck: p.nonPromotionalAck,
          by,
        })
        return { ok: true, outcome: `campagna creata: ${campaign.total} destinatari, parte ${romeDateTime(campaign.scheduled_at)}` }
      }
      case 'wa_add_contact': {
        const res = await addContact({ phone: p.phone, name: p.name, sector: p.sector, tags: p.tags, note: p.note, consent: true, source: 'manuale', by })
        return { ok: true, outcome: `${res.created ? 'aggiunto' : 'aggiornato'}: ${res.contact.name || res.contact.phone}${res.note ? ` (${res.note})` : ''}` }
      }
      case 'wa_consent_request': {
        const res = await requestConsent(p.phone, { text: p.text, by })
        return res.ok ? { ok: true, outcome: `richiesta inviata a ${p.name}` } : res
      }
    }
  } catch (error) {
    if (error instanceof WaError) return { ok: false, error: error.message, retryable: false }
    throw error
  }
}
