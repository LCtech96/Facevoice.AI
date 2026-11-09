import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { romeLocalToIso, WA_DISPLAY_NUMBER, WA_MANAGER_URL, PRICES_NOTE } from '@/lib/wa-shared'
import {
  SETUP_MESSAGE,
  WaError,
  addContact,
  addLeads,
  costOverview,
  importCsv,
  listContacts,
  loadSettings,
  loadTemplates,
  requestConsent,
  resubscribe,
  saveSettings,
  searchLeads,
  syncTemplates,
  tablesReady,
  unsubscribe,
  findContact,
  updateContact,
} from '@/lib/wa-store'
import { audienceLanguages, campaignAction, campaignRecipients, createCampaign, listCampaigns, normalizeAudience, normalizeVariables, previewAudience, withVersions } from '@/lib/wa-campaigns'
import { findTemplate } from '@/lib/wa-store'
import { createWaMediaUpload, listWaMedia } from '@/lib/wa-media'
import type { WaMediaKind } from '@/lib/wa-media-shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Campagne WhatsApp (solo admin). GET: tutto quello che serve alla pagina.
// POST { action, ... }: modifiche (contatti, modelli, campagne, impostazioni).
// Senza lo SQL delle campagne la pagina mostra l'avviso e niente si rompe.

function errorResponse(error: unknown) {
  if (error instanceof WaError) return NextResponse.json({ error: error.message, setup: error.setup || undefined }, { status: error.status })
  console.error('admin whatsapp:', error)
  return NextResponse.json({ error: 'Qualcosa non è andato: riprova.' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  try {
    const [settings, templates, ready] = await Promise.all([loadSettings(), loadTemplates(), tablesReady()])
    const base = { settings, templates, number: WA_DISPLAY_NUMBER, managerUrl: WA_MANAGER_URL, pricesNote: PRICES_NOTE, tokenConfigured: Boolean((process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN)?.trim()) }
    if (!ready) return NextResponse.json({ ...base, ready: false, setupMessage: SETUP_MESSAGE })
    const forceReal = req.nextUrl.searchParams.get('real') === '1'
    const [contacts, campaigns, costs] = await Promise.all([listContacts(), listCampaigns(), costOverview({ forceReal })])
    return NextResponse.json({ ...base, ready: true, contacts, campaigns, costs })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  const by = await getAdminEmail(req)
  if (!by) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = typeof body?.action === 'string' ? body.action : ''
  try {
    switch (action) {
      case 'save_settings':
        return NextResponse.json({ settings: await saveSettings(body.settings || {}) })
      case 'sync_templates':
        return NextResponse.json({ templates: await syncTemplates() })
      case 'media_upload': {
        // File dell'intestazione di una campagna: indirizzo firmato, il browser carica direttamente.
        const kinds = (['image', 'video', 'document'] as WaMediaKind[]).filter((k) => k === body.kind)
        if (!kinds.length) throw new WaError('Tipo di file non valido.')
        return NextResponse.json(await createWaMediaUpload({ fileName: body.fileName, type: body.type, size: body.size }, kinds, 'campagne'))
      }
      case 'media_list':
        return NextResponse.json({ media: await listWaMedia('campagne') })
      case 'leads_search':
        return NextResponse.json({ leads: await searchLeads(typeof body.q === 'string' ? body.q : '') })
    }
    if (!(await tablesReady())) return NextResponse.json({ error: SETUP_MESSAGE, setup: true }, { status: 503 })
    switch (action) {
      case 'add_contact': {
        const res = await addContact({ ...body.contact, consent: body.contact?.consent === true, source: 'manuale', by })
        return NextResponse.json(res)
      }
      case 'import_csv': {
        if (typeof body.csv !== 'string' || body.csv.length > 2_000_000) throw new WaError('File CSV mancante o troppo grande.')
        return NextResponse.json(await importCsv(body.csv, { note: body.note, consent: body.consent === true, tags: body.tags, by }))
      }
      case 'add_leads':
        return NextResponse.json(await addLeads(body.leadIds, { note: body.note, consent: body.consent === true, tags: body.tags, by }))
      case 'update_contact':
        return NextResponse.json({ contact: await updateContact(String(body.id || ''), body.patch || {}) })
      case 'unsubscribe_contact': {
        const contact = await findContact(String(body.id || ''))
        if (!contact) throw new WaError('Contatto non trovato.', 404)
        await unsubscribe(contact, `disiscritto a mano da ${by}`)
        return NextResponse.json({ ok: true })
      }
      case 'resubscribe_contact':
        await resubscribe(String(body.id || ''), { consent: body.consent === true, note: body.note, by })
        return NextResponse.json({ ok: true })
      case 'request_consent': {
        const res = await requestConsent(String(body.id || ''), { text: typeof body.text === 'string' ? body.text : undefined, by })
        if (!res.ok) throw new WaError(res.error.charAt(0).toUpperCase() + res.error.slice(1), res.retryable ? 502 : 400)
        return NextResponse.json({ ok: true })
      }
      case 'preview_audience': {
        const template = await findTemplate(String(body.templateName || ''), body.templateLanguage)
        if (!template) throw new WaError('Modello non trovato.')
        const p = await previewAudience(template.category, normalizeAudience(body.audience))
        const { template: full, excluded } = await withVersions(template, normalizeVariables(body.variables))
        return NextResponse.json({
          eligible: p.eligible.length,
          matched: p.matched,
          skipped: p.skipped,
          sample: p.eligible.slice(0, 5).map((c) => c.name || c.phone),
          languages: audienceLanguages(full, p.eligible),
          excludedLanguages: excluded,
        })
      }
      case 'create_campaign': {
        const scheduledAt = body.scheduledAt ? romeLocalToIso(String(body.scheduledAt)) : new Date().toISOString()
        if (!scheduledAt) throw new WaError('Data e ora non valide.')
        const res = await createCampaign({
          name: body.name,
          templateName: String(body.templateName || ''),
          templateLanguage: typeof body.templateLanguage === 'string' ? body.templateLanguage : undefined,
          variables: normalizeVariables(body.variables),
          audience: normalizeAudience(body.audience),
          scheduledAt,
          nonPromotionalAck: body.nonPromotionalAck === true,
          by,
        })
        return NextResponse.json(res)
      }
      case 'campaign_action': {
        const op = body.op
        if (op !== 'pause' && op !== 'resume' && op !== 'cancel') throw new WaError('Operazione non valida.')
        return NextResponse.json({ campaign: await campaignAction(String(body.id || ''), op) })
      }
      case 'campaign_recipients':
        return NextResponse.json({ recipients: await campaignRecipients(String(body.id || '')) })
      default:
        return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
