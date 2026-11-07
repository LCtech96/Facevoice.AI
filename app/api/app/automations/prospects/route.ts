import { NextRequest, NextResponse, after } from 'next/server'
import { requireAutomations } from '@/lib/automations-access'
import {
  ProspectError,
  approveAllProspects,
  approveProspect,
  blockAddress,
  discardProspect,
  processDueProspects,
  prospectsOverview,
  regenerateProspect,
  requestProspectSearch,
  restoreProspect,
  saveProspectSettings,
  sendProspectNow,
  unblockAddress,
} from '@/lib/saas/prospects'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Trova clienti (pagina Automazioni): GET impostazioni, aziende trovate, bozze e contatori;
// POST { action } per salvare le impostazioni, "Cerca ora", approvare, modificare, inviare
// subito, riscrivere, scartare (e ripristinare) e la lista "Non contattare". Solo per chi ha le automazioni
// attive (lib/automations-access.ts); per cambiare serve il ruolo di amministratore.

const failure = (error: unknown, label: string) => {
  if (error instanceof ProspectError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status })
  console.error(`app trova clienti ${label}:`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: 'Trova clienti non disponibile, riprova.' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const access = await requireAutomations(req)
  if (access instanceof NextResponse) return access
  try {
    const overview = await prospectsOverview(access.db)
    return NextResponse.json({ ...overview, canManage: access.workspace.role !== 'member' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return failure(error, 'elenco')
  }
}

const id = (body: Record<string, unknown>) => (typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null)

export async function POST(req: NextRequest) {
  const access = await requireAutomations(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  const db = access.db
  const needId = () => {
    const value = id(body)
    if (!value) throw new ProspectError('Dati non validi')
    return value
  }
  const draft = { subject: body.subject, body: body.body }
  try {
    let extra: Record<string, unknown> = {}
    switch (body.action) {
      case 'settings': {
        const saved = await saveProspectSettings(db, access.userId, (body.settings && typeof body.settings === 'object' ? body.settings : body) as Record<string, unknown>)
        extra = { warning: saved.warning }
        break
      }
      case 'search_now': {
        const run = await requestProspectSearch(db, access.userId)
        // Parte subito dopo la risposta (dentro il tempo di questa funzione), poi la continua il cron.
        after(() =>
          processDueProspects({ workspaceId: db.workspaceId, budgetMs: 100_000 }).catch((error) =>
            console.error('trova clienti cerca ora:', error instanceof Error ? error.message : error)
          )
        )
        extra = { started: run.id }
        break
      }
      case 'approve':
        extra = { prospect: await approveProspect(db, needId(), draft) }
        break
      case 'approve_all':
        extra = { approved: await approveAllProspects(db) }
        break
      case 'send_now':
        extra = { prospect: await sendProspectNow(db, needId(), draft) }
        break
      case 'regenerate':
        extra = { prospect: await regenerateProspect(db, needId()) }
        break
      case 'discard':
        extra = { prospect: await discardProspect(db, needId()) }
        break
      case 'restore':
        extra = { prospect: await restoreProspect(db, needId()) }
        break
      case 'do_not_contact':
        extra = body.id ? { prospect: await discardProspect(db, needId(), { block: true }) } : { blocked: await blockAddress(db.workspaceId, String(body.entry ?? ''), { manual: true }) }
        break
      case 'unblock':
        await unblockAddress(db.workspaceId, String(body.entry ?? ''))
        break
      default:
        return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, ...extra, ...(await prospectsOverview(db)) })
  } catch (error) {
    return failure(error, String(body.action))
  }
}
