import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateSetting } from '@/lib/settings-store'
import { sendPushToAdmins } from '@/lib/push'
import {
  buildTemplateComponents,
  consentAnswer,
  contactLanguage,
  detectContactLanguage,
  languageSplit,
  pickTemplateVersion,
  templateVersions,
  withLanguageTag,
  eligibilityFor,
  isOptOut,
  missingVariables,
  normalizePhone,
  priceFor,
  renderPreview,
  romeMonth,
  formatEur,
  type Audience,
  type CampaignStatus,
  type VariableMapping,
  type WaCampaign,
  type WaContact,
  type WaSettings,
  type WaTemplate,
} from '@/lib/wa-shared'
import {
  WaError,
  check,
  costOverview,
  findContactByPhone,
  findTemplate,
  listContacts,
  loadSettings,
  loadTemplates,
  logOutgoing,
  nowIso,
  realPricing,
  selectAll,
  sendTemplateMessage,
  sendTextMessage,
  tablesReady,
  unsubscribe,
} from '@/lib/wa-store'
import { checkMediaLink } from '@/lib/wa-media'
import { mediaKindOfHeader } from '@/lib/wa-media-shared'

// Campagne WhatsApp: creazione (pubblico fissato al momento della creazione),
// invio a lotti dal cron (limite giornaliero, budget mensile, una sola esecuzione
// alla volta, ogni destinatario preso da una sola esecuzione), stati da Meta,
// risposte e disiscrizioni dai messaggi in arrivo.

const PER_TICK_MAX = 60
const TICK_TIME_MS = 35_000
const STALE_SENDING_MS = 10 * 60_000
const REPLY_WINDOW_MS = 7 * 86400_000
const CONSENT_WINDOW_MS = 7 * 86400_000
/** Meta: il destinatario ha bloccato i messaggi promozionali di questa azienda. */
const OPTED_OUT_CODE = 131050

// ---------------------------------------------------------------------
// Pubblico
// ---------------------------------------------------------------------

function matchesAudience(c: WaContact, a: Audience): boolean {
  if (a.contactIds?.length) return a.contactIds.includes(c.id)
  if (a.tags?.length && !a.tags.some((t) => (c.tags || []).includes(t.toLowerCase()))) return false
  if (a.sector?.trim()) {
    const s = a.sector.trim().toLowerCase()
    const hay = [c.sector, ...(c.tags || []), c.company].filter(Boolean).join(' ').toLowerCase()
    if (!hay.includes(s)) return false
  }
  return true
}

export function normalizeAudience(raw: unknown): Audience {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean)
  return {
    ...(list(r.tags).length ? { tags: list(r.tags).map((t) => t.toLowerCase()).slice(0, 20) } : {}),
    ...(typeof r.sector === 'string' && r.sector.trim() ? { sector: r.sector.trim().slice(0, 80) } : {}),
    ...(list(r.contactIds).length ? { contactIds: list(r.contactIds).slice(0, 5000) } : {}),
  }
}

export type AudiencePreview = { eligible: WaContact[]; skipped: Record<string, number>; matched: number }

/** Il modello scelto (lingua predefinita) con le altre lingue approvate usabili con le stesse variabili. */
export async function withVersions(template: WaTemplate, variables: Record<string, VariableMapping>) {
  const { items } = await loadTemplates()
  const { versions, excluded } = templateVersions(items, template, variables)
  return { template: { ...template, versions } as WaTemplate, excluded }
}

/** Destinatari per lingua del modello (es. { it: 40, en_US: 3 }). */
export const audienceLanguages = (template: WaTemplate, eligible: WaContact[]) => languageSplit(template, eligible)

/** Chi riceverebbe la campagna adesso, e chi resta fuori (con il motivo). */
export async function previewAudience(category: string, audience: Audience, contacts?: WaContact[]): Promise<AudiencePreview> {
  const all = contacts || (await listContacts())
  const matched = all.filter((c) => matchesAudience(c, audience))
  const eligible: WaContact[] = []
  const skipped: Record<string, number> = {}
  for (const c of matched) {
    const e = eligibilityFor(c, category)
    if (e.ok) eligible.push(c)
    else skipped[e.reason] = (skipped[e.reason] || 0) + 1
  }
  return { eligible, skipped, matched: matched.length }
}

/** Controlli comuni (pagina e super chat): modello approvato, categoria, variabili. */
export function validateCampaignTemplate(template: WaTemplate | null, variables: Record<string, VariableMapping>, nonPromotionalAck: boolean): string | null {
  if (!template) return 'modello non trovato: aggiorna i modelli da Meta'
  if (template.status !== 'APPROVED') return `il modello «${template.name}» non è approvato da Meta (stato: ${template.status})`
  if (template.unsupported) return `il modello «${template.name}» ${template.unsupported}: da qui non si può usare`
  if (template.category === 'AUTHENTICATION') return 'i modelli di autenticazione non si usano nelle campagne'
  if (template.category !== 'MARKETING' && template.category !== 'UTILITY') return `categoria ${template.category} non gestita`
  if (template.category === 'UTILITY' && !nonPromotionalAck) return 'per un modello di servizio (UTILITY) conferma che il messaggio non è promozionale'
  const missing = missingVariables(template, variables)
  if (missing.length) return `imposta le variabili: ${missing.join(', ')}`
  return null
}

export function normalizeVariables(raw: unknown): Record<string, VariableMapping> {
  const out: Record<string, VariableMapping> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!/^(header|body):[\w]+$/.test(k) || !v || typeof v !== 'object') continue
    const type = v.type === 'nome' ? 'nome' : 'fisso'
    out[k] = { type, value: typeof v.value === 'string' ? v.value.slice(0, 1000) : '' }
  }
  return out
}

export type CreateCampaignInput = {
  name?: unknown
  templateName: string
  templateLanguage?: string
  variables: Record<string, VariableMapping>
  audience: Audience
  scheduledAt: string
  nonPromotionalAck?: boolean
  by?: string | null
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ campaign: WaCampaign; skipped: Record<string, number> }> {
  const template = await findTemplate(input.templateName, input.templateLanguage)
  const problem = validateCampaignTemplate(template, input.variables, Boolean(input.nonPromotionalAck))
  if (problem) throw new WaError(problem.charAt(0).toUpperCase() + problem.slice(1))
  const when = Date.parse(input.scheduledAt)
  if (!Number.isFinite(when)) throw new WaError('Data e ora non valide.')
  if (when < Date.now() - 5 * 60_000) throw new WaError('La data scelta è già passata.')
  // Le altre lingue approvate dello stesso modello vanno nella copia salvata: ogni destinatario
  // riceve la versione nella sua lingua, o quella predefinita (scelta nel modulo).
  const t = (await withVersions(template as WaTemplate, input.variables)).template
  // Modello con immagine, video o PDF: il file deve rispondere al link (Meta lo scarica a ogni invio).
  const mediaKind = mediaKindOfHeader(t.headerFormat)
  if (mediaKind) await checkMediaLink(input.variables['header:media']?.value?.trim() || '', mediaKind)
  const preview = await previewAudience(t.category, input.audience)
  if (!preview.eligible.length) throw new WaError('Nessun contatto può ricevere questa campagna (servono contatti attivi con il consenso).')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : `${t.name} · ${new Date(when).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`
  const { data: campaign, error } = await supabaseAdmin
    .from('wa_campaigns')
    .insert({
      name,
      template_name: t.name,
      template_language: t.language,
      template_category: t.category,
      template_snapshot: t,
      variables: input.variables,
      audience: input.audience,
      status: 'scheduled',
      scheduled_at: new Date(when).toISOString(),
      created_by: input.by || null,
      total: preview.eligible.length,
    })
    .select('*')
    .single()
  check(error, 'nuova campagna')
  const rows = preview.eligible.map((c) => ({ campaign_id: campaign.id, contact_id: c.id, phone: c.phone, name: c.name, status: 'queued' }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await supabaseAdmin.from('wa_campaign_recipients').insert(rows.slice(i, i + 500))
    if (e) {
      await supabaseAdmin.from('wa_campaigns').delete().eq('id', campaign.id)
      check(e, 'destinatari')
    }
  }
  return { campaign: campaign as WaCampaign, skipped: preview.skipped }
}

export type CampaignWithCounts = WaCampaign & { counts: Record<string, number>; replies: number }

export async function listCampaigns(limit = 100): Promise<CampaignWithCounts[]> {
  const { data, error } = await supabaseAdmin.from('wa_campaigns').select('*').order('created_at', { ascending: false }).limit(limit)
  check(error, 'campagne')
  const campaigns = (data || []) as WaCampaign[]
  if (!campaigns.length) return []
  const rows = await selectAll<{ campaign_id: string; status: string; replied_at: string | null }>(
    (a, b) => supabaseAdmin.from('wa_campaign_recipients').select('campaign_id, status, replied_at').in('campaign_id', campaigns.map((c) => c.id)).range(a, b) as any,
    'destinatari'
  )
  return campaigns.map((c) => {
    const counts: Record<string, number> = {}
    let replies = 0
    for (const r of rows) {
      if (r.campaign_id !== c.id) continue
      counts[r.status] = (counts[r.status] || 0) + 1
      if (r.replied_at) replies++
    }
    return { ...c, counts, replies }
  })
}

export async function campaignRecipients(id: string) {
  return selectAll<Record<string, unknown>>(
    (a, b) =>
      supabaseAdmin
        .from('wa_campaign_recipients')
        .select('id, phone, name, status, sent_at, delivered_at, read_at, failed_at, error_code, error_message, skip_reason, replied_at')
        .eq('campaign_id', id)
        .order('created_at', { ascending: true })
        .range(a, b) as any,
    'destinatari'
  )
}

/** Pausa, ripresa, annullamento. Annullare: i messaggi non ancora partiti non partono piu'. */
export async function campaignAction(id: string, op: 'pause' | 'resume' | 'cancel'): Promise<WaCampaign> {
  const { data: c, error } = await supabaseAdmin.from('wa_campaigns').select('*').eq('id', id).maybeSingle()
  check(error, 'campagna')
  if (!c) throw new WaError('Campagna non trovata.', 404)
  const from: Record<typeof op, CampaignStatus[]> = { pause: ['scheduled', 'sending'], resume: ['paused'], cancel: ['scheduled', 'sending', 'paused'] }
  if (!from[op].includes(c.status)) throw new WaError(`La campagna è ${c.status === 'completed' ? 'già completata' : c.status === 'cancelled' ? 'annullata' : 'in uno stato che non lo permette'}.`)
  const patch: Record<string, unknown> = { updated_at: nowIso() }
  if (op === 'pause') Object.assign(patch, { status: 'paused', paused_reason: 'manuale' })
  if (op === 'resume') Object.assign(patch, { status: c.started_at ? 'sending' : 'scheduled', paused_reason: null })
  if (op === 'cancel') Object.assign(patch, { status: 'cancelled', paused_reason: null, completed_at: nowIso() })
  const { data, error: e } = await supabaseAdmin.from('wa_campaigns').update(patch).eq('id', id).in('status', from[op]).select('*').maybeSingle()
  check(e, 'stato campagna')
  if (!data) throw new WaError('La campagna è cambiata nel frattempo: ricarica.', 409)
  if (op === 'cancel') await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'skipped', skip_reason: 'annullata' }).eq('campaign_id', id).eq('status', 'queued')
  return data as WaCampaign
}

// ---------------------------------------------------------------------
// Invio dal cron
// ---------------------------------------------------------------------

const LOCK_KEY = 'wa_campaign_lock'
const parseLock = (raw: string | null): { until: number; token: string | null } => {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { until: Number(v?.until) || 0, token: typeof v?.token === 'string' ? v.token : null }
  } catch {
    return { until: 0, token: null }
  }
}

async function acquireLock(ms: number): Promise<string | null> {
  const token = randomUUID()
  const now = Date.now()
  const after = await updateSetting(LOCK_KEY, parseLock, (cur) => (cur.token && cur.until > now ? false : { until: now + ms, token }))
  return after.token === token ? token : null
}

async function releaseLock(token: string) {
  await updateSetting(LOCK_KEY, parseLock, (cur) => (cur.token === token ? { until: 0, token: null } : false)).catch(() => undefined)
}

/** Messaggi partiti nelle ultime 24 ore (limite di Meta sui contatti unici al giorno). */
async function sentLast24h(now: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', new Date(now - 24 * 3600_000).toISOString())
  check(error, 'limite giornaliero')
  return count || 0
}

/**
 * Spesa del mese per il budget: consegnati (stima) o costo reale da Meta se piu' alto,
 * piu' gli inviati non ancora consegnati (si contano gia', per prudenza).
 */
export async function monthSpend(settings: WaSettings, now = Date.now()): Promise<number> {
  const overview = await costOverview({ withReal: false })
  const month = romeMonth(now)
  const cached = await realPricing(false).catch(() => null)
  const real = cached?.status === 'ok' ? Object.entries(cached.days).filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + v, 0) : 0
  const { data: pending } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .select('campaign_id')
    .eq('status', 'sent')
    .gte('sent_at', new Date(now - 48 * 3600_000).toISOString())
    .limit(10000)
  const cats = new Map(overview.campaigns.map((c) => [c.id, c.category]))
  const committed = (pending || []).reduce((s, r: { campaign_id: string }) => s + priceFor(settings.prices, cats.get(r.campaign_id) || 'MARKETING'), 0)
  return Math.max(overview.estimatedMonth, real) + committed
}

async function pauseForBudget(campaignIds: string[], settings: WaSettings, spent: number) {
  if (!campaignIds.length) return
  const { data } = await supabaseAdmin
    .from('wa_campaigns')
    .update({ status: 'paused', paused_reason: 'budget', updated_at: nowIso() })
    .in('id', campaignIds)
    .in('status', ['scheduled', 'sending'])
    .select('id, name')
  if (!data?.length) return
  await sendPushToAdmins({
    title: 'Campagne WhatsApp in pausa',
    body: `Budget mensile raggiunto (${formatEur(spent)} su ${formatEur(settings.monthlyBudget)}): ${data.map((c: { name: string }) => c.name).join(', ')}. Alza il budget o riprendi il mese prossimo.`,
    url: '/admin/whatsapp',
    tag: 'wa-budget',
  }).catch((error) => console.error('whatsapp: notifica budget non inviata:', error))
}

async function finishIfDone(campaignId: string) {
  const { count } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['queued', 'sending'])
  if (!count) await supabaseAdmin.from('wa_campaigns').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('id', campaignId).eq('status', 'sending')
}

/** Destinatari presi da questa esecuzione: un altro cron non li puo' prendere (UPDATE ... WHERE status = 'queued'). */
async function claimBatch(campaignId: string, n: number, token: string) {
  const { data: ids, error } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(n)
  check(error, 'coda')
  if (!ids?.length) return []
  const { data, error: e } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .update({ status: 'sending', claim: token, claimed_at: nowIso() })
    .in('id', ids.map((r: { id: string }) => r.id))
    .eq('status', 'queued')
    .select('id, contact_id, phone, name, claim')
  check(e, 'coda')
  return ((data || []) as { id: string; contact_id: string | null; phone: string; name: string | null; claim: string }[]).filter((r) => r.claim === token)
}

export type TickResult = { skipped?: string; sent: number; failed: number; skippedRecipients: number; paused?: string[] }

export async function waCampaignTick(opts: { now?: number; timeMs?: number } = {}): Promise<TickResult> {
  const result: TickResult = { sent: 0, failed: 0, skippedRecipients: 0 }
  if (!(await tablesReady())) return { ...result, skipped: 'sql' }
  const now = opts.now ?? Date.now()
  const nowISO = new Date(now).toISOString()
  // Niente da fare: nessun lucchetto.
  const { data: due, error } = await supabaseAdmin
    .from('wa_campaigns')
    .select('*')
    .in('status', ['scheduled', 'sending'])
    .lte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true })
  check(error, 'campagne da inviare')
  // Invii rimasti a meta' (esecuzione interrotta): non si riprovano, l'esito non si sa.
  await supabaseAdmin
    .from('wa_campaign_recipients')
    .update({ status: 'failed', failed_at: nowISO, error_message: 'invio interrotto: esito non sicuro, non riprovato per evitare doppioni', claim: null })
    .eq('status', 'sending')
    .lt('claimed_at', new Date(now - STALE_SENDING_MS).toISOString())
  if (!due?.length) return { ...result, skipped: 'niente' }

  const token = await acquireLock(TICK_TIME_MS + 20_000)
  if (!token) return { ...result, skipped: 'occupato' }
  const started = Date.now()
  const timeLeft = () => (opts.timeMs ?? TICK_TIME_MS) - (Date.now() - started)
  try {
    const settings = await loadSettings()
    let capLeft = settings.dailyCap - (await sentLast24h(now))
    if (capLeft <= 0) return { ...result, skipped: 'limite giornaliero' }
    let spent = settings.monthlyBudget > 0 ? await monthSpend(settings, now) : 0
    if (settings.monthlyBudget > 0 && spent >= settings.monthlyBudget) {
      await pauseForBudget((due as WaCampaign[]).map((c) => c.id), settings, spent)
      return { ...result, skipped: 'budget', paused: (due as WaCampaign[]).map((c) => c.id) }
    }
    let tickLeft = PER_TICK_MAX
    let stop = false
    for (const c of due as WaCampaign[]) {
      if (stop || capLeft <= 0 || tickLeft <= 0 || timeLeft() <= 0) break
      // Ricontrollo: messa in pausa o annullata dalla pagina un attimo fa?
      const { data: fresh } = await supabaseAdmin.from('wa_campaigns').select('status').eq('id', c.id).maybeSingle()
      if (!fresh || !['scheduled', 'sending'].includes(fresh.status)) continue
      if (fresh.status === 'scheduled') await supabaseAdmin.from('wa_campaigns').update({ status: 'sending', started_at: nowISO, updated_at: nowISO }).eq('id', c.id).eq('status', 'scheduled')
      const price = priceFor(settings.prices, c.template_category)
      let allowed = Math.min(capLeft, tickLeft)
      if (settings.monthlyBudget > 0 && price > 0) allowed = Math.min(allowed, Math.floor((settings.monthlyBudget - spent) / price + 1e-9))
      if (allowed <= 0) {
        await pauseForBudget([c.id, ...(due as WaCampaign[]).filter((d) => d.id !== c.id).map((d) => d.id)], settings, spent)
        result.paused = (due as WaCampaign[]).map((d) => d.id)
        if (!result.sent) result.skipped = 'budget'
        break
      }
      const batch = await claimBatch(c.id, allowed, token)
      const template = c.template_snapshot
      const contactIds = batch.map((r) => r.contact_id).filter((x): x is string => Boolean(x))
      const { data: contacts } = contactIds.length ? await supabaseAdmin.from('wa_contacts').select('id, phone, name, status, consent_source, consent_log, tags').in('id', contactIds) : { data: [] }
      const byId = new Map((contacts || []).map((x: any) => [x.id, x]))
      for (const [i, r] of batch.entries()) {
        if (stop || timeLeft() <= 0) {
          // Tempo finito: i rimasti tornano in coda per il prossimo giro.
          await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'queued', claim: null, claimed_at: null }).in('id', batch.slice(i).map((x) => x.id)).eq('claim', token)
          break
        }
        const contact = r.contact_id ? byId.get(r.contact_id) : null
        const eligible = contact ? eligibilityFor(contact, c.template_category) : ({ ok: false, reason: 'contatto_tolto' } as const)
        if (!eligible.ok) {
          await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'skipped', skip_reason: eligible.reason, claim: null }).eq('id', r.id).eq('claim', token)
          result.skippedRecipients++
          continue
        }
        const phone = normalizePhone(contact.phone) as string
        // Versione nella lingua del contatto, se il modello ce l'ha; altrimenti la predefinita.
        const version = pickTemplateVersion(template, contactLanguage(contact).lang)
        const components = buildTemplateComponents(version, c.variables, { name: contact.name ?? r.name })
        const sent = await sendTemplateMessage(settings, phone, { name: c.template_name, language: version.language }, components)
        if ('id' in sent) {
          await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'sent', wamid: sent.id, sent_at: new Date().toISOString(), claim: null }).eq('id', r.id).eq('claim', token)
          await logOutgoing(settings, phone, contact.name ?? r.name, `[Campagna «${c.name}»]\n${renderPreview(version, c.variables, { name: contact.name ?? r.name })}`, sent)
          result.sent++
          capLeft--
          tickLeft--
          spent += price
        } else if (sent.transient) {
          // Limite di velocita' o Meta non disponibile: si riprova al prossimo giro, senza perdere nessuno.
          console.warn(`whatsapp campagna ${c.id}: Meta rallenta (${sent.code}): ${sent.error}`)
          await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'queued', claim: null, claimed_at: null }).in('id', batch.slice(i).map((x) => x.id)).eq('claim', token)
          stop = true
        } else {
          await supabaseAdmin
            .from('wa_campaign_recipients')
            .update({ status: 'failed', failed_at: new Date().toISOString(), error_code: sent.code === null ? null : String(sent.code), error_message: sent.error.slice(0, 500), claim: null })
            .eq('id', r.id)
            .eq('claim', token)
          if (sent.code === OPTED_OUT_CODE) await unsubscribe(contact, 'Meta: ha bloccato i messaggi promozionali (131050)').catch(() => undefined)
          result.failed++
          tickLeft--
        }
      }
      await finishIfDone(c.id)
    }
    return result
  } finally {
    await releaseLock(token)
  }
}

// ---------------------------------------------------------------------
// Stati da Meta (webhook "statuses")
// ---------------------------------------------------------------------

export type WaStatus = {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
  pricing?: { billable?: boolean; category?: string; pricing_model?: string; type?: string }
}

const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, failed: 2, delivered: 3, read: 4 }

/** Aggiorna i destinatari delle campagne (gli altri messaggi si ignorano). Restituisce quanti aggiornati. */
export async function applyStatuses(statuses: WaStatus[]): Promise<number> {
  let updated = 0
  for (const s of statuses) {
    if (!s?.id || !s.status) continue
    const { data: row, error } = await supabaseAdmin
      .from('wa_campaign_recipients')
      .select('id, status, contact_id, delivered_at, read_at')
      .eq('wamid', s.id)
      .maybeSingle()
    if (error) {
      if (!/wa_campaign_recipients/.test(error.message || '')) console.warn('whatsapp stati:', error.message)
      return updated
    }
    if (!row) continue
    const at = s.timestamp && /^\d+$/.test(s.timestamp) ? new Date(Number(s.timestamp) * 1000).toISOString() : nowIso()
    const patch: Record<string, unknown> = {}
    if (s.pricing) {
      if (typeof s.pricing.billable === 'boolean') patch.billable = s.pricing.billable
      if (s.pricing.category) patch.pricing_category = String(s.pricing.category).toLowerCase()
    }
    const cur = RANK[row.status] ?? 0
    if (s.status === 'delivered') {
      if (!row.delivered_at) patch.delivered_at = at
      if (cur < RANK.delivered || row.status === 'failed') patch.status = 'delivered'
    } else if (s.status === 'read') {
      patch.read_at = row.read_at || at
      if (!row.delivered_at) patch.delivered_at = at
      patch.status = 'read'
    } else if (s.status === 'failed') {
      if (cur < RANK.delivered) {
        const e = s.errors?.[0]
        Object.assign(patch, {
          status: 'failed',
          failed_at: at,
          error_code: e?.code !== undefined ? String(e.code) : null,
          error_message: [e?.title || e?.message, e?.error_data?.details].filter(Boolean).join(': ').slice(0, 500) || 'non consegnato',
        })
        if (e?.code === OPTED_OUT_CODE && row.contact_id) {
          const { data: contact } = await supabaseAdmin.from('wa_contacts').select('id, status, consent_log').eq('id', row.contact_id).maybeSingle()
          if (contact) await unsubscribe(contact as WaContact, 'Meta: ha bloccato i messaggi promozionali (131050)').catch(() => undefined)
        }
      }
    } else if (s.status === 'sent') {
      if (cur < RANK.sent) patch.status = 'sent'
    }
    if (!Object.keys(patch).length) continue
    const { error: e } = await supabaseAdmin.from('wa_campaign_recipients').update(patch).eq('id', row.id)
    if (!e) updated++
  }
  return updated
}

// ---------------------------------------------------------------------
// Messaggi in arrivo: contattabili, STOP, risposta alla richiesta di consenso, risposte alle campagne
// ---------------------------------------------------------------------

export type InboundInput = {
  waId: string
  name: string | null
  text: string | null
  /** Bottone premuto (modello o domanda con bottoni). */
  fromButton?: boolean
  buttonId?: string | null
}
export type InboundOutcome = { silent: boolean; kind: 'none' | 'optout' | 'consent_yes' | 'consent_no'; after?: () => Promise<void> }

const OPTOUT_REPLY = 'Fatto: non riceverai più messaggi promozionali da Facevoice AI. Se cambi idea o ti serve qualcosa, scrivici pure qui.'
const YES_REPLY = 'Perfetto, grazie! Ti scriveremo solo ogni tanto con novità utili. Per smettere basta scrivere STOP.'
const NO_REPLY = 'Nessun problema, non ti manderemo messaggi promozionali. Per qualsiasi cosa scrivici pure qui.'

/**
 * Da chiamare per ogni messaggio WhatsApp in arrivo, prima di salvarlo in casella.
 * silent: l'AI non deve rispondere (abbiamo gia' risposto noi: STOP o consenso).
 * after: la conferma da mandare dopo aver salvato il messaggio in casella.
 * Senza le tabelle (SQL non eseguito) non fa niente.
 */
export async function waInbound(input: InboundInput): Promise<InboundOutcome> {
  const none: InboundOutcome = { silent: false, kind: 'none' }
  const phone = normalizePhone(`+${input.waId.replace(/\D/g, '')}`)
  if (!phone) return none
  const at = nowIso()
  let contact: WaContact | null
  try {
    contact = await findContactByPhone(phone)
  } catch (error) {
    if (error instanceof WaError && error.setup) return none
    throw error
  }
  // Lingua dai suoi messaggi scritti (non dai bottoni), se chiara: per scegliere la versione dei modelli.
  const detected = input.fromButton ? null : detectContactLanguage(input.text)
  if (!contact) {
    const { data, error } = await supabaseAdmin
      .from('wa_contacts')
      .insert({ phone, name: input.name, tags: withLanguageTag([], detected, false), consent_source: 'ha_scritto', consent_at: at, consent_note: 'Ha scritto per primo su WhatsApp (solo risposte di servizio)', status: 'attivo', last_inbound_at: at, consent_log: [{ at, event: 'ha_scritto' }] })
      .select('*')
      .single()
    if (error && error.code !== '23505') {
      check(error, 'contatto in arrivo')
    }
    contact = (data as WaContact) || (await findContactByPhone(phone))
    if (!contact) return none
  } else {
    const current = contactLanguage(contact)
    const language = detected && !current.manual && current.lang !== detected ? { tags: withLanguageTag(contact.tags, detected, false) } : {}
    await supabaseAdmin.from('wa_contacts').update({ last_inbound_at: at, ...(contact.name ? {} : { name: input.name }), ...language }).eq('id', contact.id)
  }

  // Risposta a una campagna degli ultimi 7 giorni: conta come risposta (una per destinatario).
  const { data: rec } = await supabaseAdmin
    .from('wa_campaign_recipients')
    .select('id')
    .eq('phone', phone)
    .is('replied_at', null)
    .in('status', ['sent', 'delivered', 'read'])
    .gte('sent_at', new Date(Date.now() - REPLY_WINDOW_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (rec) await supabaseAdmin.from('wa_campaign_recipients').update({ replied_at: at }).eq('id', rec.id)

  const settings = await loadSettings()
  const reply = (text: string) => async () => {
    const sent = await sendTextMessage(settings, phone, text)
    await logOutgoing(settings, phone, contact!.name || input.name, text, sent)
    if ('error' in sent) console.error('whatsapp: conferma non inviata:', sent.error)
  }

  if (isOptOut(input.text, input.fromButton)) {
    // Stesso STOP rimandato da Meta (o scritto due volte di fila): una conferma sola.
    if (contact.status === 'disiscritto' && contact.unsubscribed_at && Date.now() - Date.parse(contact.unsubscribed_at) < 10 * 60_000) {
      return { silent: true, kind: 'optout' }
    }
    await unsubscribe(contact, `ha scritto: «${(input.text || '').slice(0, 100)}»`)
    return { silent: true, kind: 'optout', after: reply(OPTOUT_REPLY) }
  }

  const recentRequest = contact.consent_requested_at && Date.now() - Date.parse(contact.consent_requested_at) < CONSENT_WINDOW_MS
  const answer = consentAnswer(input.text, input.buttonId)
  if (answer && (recentRequest || input.buttonId) && contact.status === 'attivo' && contact.consent_source === 'ha_scritto') {
    const requested = contact.consent_requested_at ? new Date(contact.consent_requested_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : 'recente'
    const note = `Ha risposto «${(input.text || answer).slice(0, 100)}» alla richiesta di consenso del ${requested}`
    if (answer === 'yes') {
      await supabaseAdmin
        .from('wa_contacts')
        .update({ consent_source: 'risposta_si', consent_at: at, consent_note: note, consent_declined_at: null, updated_at: at, consent_log: [...(contact.consent_log || []), { at, event: 'consenso: risposta_si', note }] })
        .eq('id', contact.id)
      return { silent: true, kind: 'consent_yes', after: reply(YES_REPLY) }
    }
    await supabaseAdmin
      .from('wa_contacts')
      .update({ consent_declined_at: at, updated_at: at, consent_log: [...(contact.consent_log || []), { at, event: 'consenso rifiutato', note }] })
      .eq('id', contact.id)
    return { silent: true, kind: 'consent_no', after: reply(NO_REPLY) }
  }
  return none
}
