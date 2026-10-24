import { NextRequest, NextResponse, after } from 'next/server'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import { asModelChoice } from '@/lib/ai'
import {
  asScope,
  continuationMessage,
  isRunning,
  isStale,
  loadState,
  newId,
  recoverStaleJob,
  runJob,
  updateState,
  type Job,
  type Scope,
  type Turn,
} from '@/lib/assistant-state'
import { internalKey, requestRound, resumeOrClose } from '@/lib/assistant-launch'
import { parseBudget } from '@/lib/assistant-budget'

export const dynamic = 'force-dynamic'
// Il lavoro continua dopo la risposta (after): serve il tempo massimo.
export const maxDuration = 300

/**
 * Permessi per scope: la chat della pagina Clienti richiede "assistant" su Clienti;
 * la super chat "view" per leggere e "use" per scrivere. I giri successivi
 * passano con la chiave del server.
 */
async function authorized(req: NextRequest, scope: Scope, write: boolean) {
  const key = internalKey()
  if (key && req.headers.get('x-internal-key') === key) return true
  const access = await getStaffAccess(req)
  if (scope === 'super') return canAccess(access, 'assistant', write ? 'use' : 'view')
  return canAccess(access, 'leads', 'assistant')
}

/** Esegue il giro dopo aver risposto: prosegue anche se la pagina si chiude. */
function launch(req: NextRequest, scope: Scope, jobId: string, message: string) {
  const origin = req.nextUrl.origin
  after(() => runJob(scope, jobId, message, (round) => requestRound(origin, scope, jobId, round)))
}

/** "continua", "vai avanti"…: riprende l'ultima richiesta senza rifare i passi gia' fatti. */
const CONTINUE_RE = /^\s*(continua|continuare|vai avanti|prosegui|riprendi|vai)\b[\s.!]*$/i

/** Stato della conversazione: ?scope=leads|super */
export async function GET(req: NextRequest) {
  const scope = asScope(req.nextUrl.searchParams.get('scope'))
  if (!(await authorized(req, scope, false))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  // Lavoro fermo (il server ha chiuso la funzione): riparte da solo.
  const state = await resumeOrClose(req.nextUrl.origin, scope, await loadState(scope))
  return NextResponse.json({ ...state, running: isRunning(state.job) })
}

/**
 * Nuova richiesta. body: { scope, message, model? }
 * Giro successivo (interno, con x-internal-key): { scope, jobId, round }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scope = asScope(body?.scope)
  if (!(await authorized(req, scope, true))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const key = internalKey()
  const internal = Boolean(key) && req.headers.get('x-internal-key') === key

  if (internal && typeof body?.jobId === 'string') {
    // Giro successivo: stesso lavoro, nuovo giro. Lo avvia uno solo (chi arriva dopo riceve 409).
    const jobId = body.jobId
    const round = Math.max(1, Number(body.round) || 1)
    let job: Job | null = null
    await updateState(scope, (s) => {
      if (!s.job || s.job.id !== jobId || s.job.status !== 'running' || (s.job.round ?? 0) >= round) return false
      const resumed = isStale(s.job)
      s.job.round = round
      s.job.run = newId()
      if (resumed) s.job.statusText = 'Riprendo da dove mi ero fermato…'
      s.job.updatedAt = new Date().toISOString()
      job = { ...s.job }
    })
    if (!job) return NextResponse.json({ error: 'Giro già avviato o lavoro chiuso' }, { status: 409 })
    launch(req, scope, jobId, continuationMessage((job as Job).original))
    return NextResponse.json({ ok: true })
  }

  const text = String(body?.message || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'Scrivi cosa vuoi fare' }, { status: 400 })

  const current = await recoverStaleJob(scope, await loadState(scope))
  if (isRunning(current.job)) {
    return NextResponse.json({ error: 'Sto ancora lavorando alla richiesta precedente: aspetta che finisca.' }, { status: 409 })
  }

  // "continua" dopo un lavoro fermato: si riprende quella richiesta con i passi gia' fatti.
  const previous = current.job
  const resuming = CONTINUE_RE.test(text) && Boolean(previous?.original) && Boolean(previous?.steps?.length)
  const original = resuming ? previous!.original : text

  // Limite di spesa: scritto in questa richiesta, oppure nella precedente se nel
  // frattempo l'assistente aveva solo fatto una domanda ("Va bene, ma non spendere più di…").
  let budget = parseBudget(text)
  if (!budget && resuming) budget = previous?.budget ?? null
  if (!budget) {
    const lastAssistant = [...current.turns].reverse().find((t) => t.role === 'assistant')
    const lastUser = [...current.turns].reverse().find((t) => t.role === 'user')
    if (lastAssistant?.text.trim().endsWith('?') && lastUser) budget = parseBudget(lastUser.text)
  }

  const jobId = newId()
  const now = new Date().toISOString()
  const state = await updateState(scope, (s) => {
    s.turns.push({ id: newId(), role: 'user', text })
    s.job = {
      id: jobId,
      status: 'running',
      statusText: resuming ? 'Riprendo da dove mi ero fermato…' : 'Ci penso…',
      startedAt: now,
      updatedAt: now,
      original,
      round: 0,
      model: asModelChoice(body?.model),
      budget,
      run: newId(),
      steps: resuming ? previous!.steps : undefined,
    }
  })

  launch(req, scope, jobId, resuming ? continuationMessage(original) : original)
  return NextResponse.json({ ...state, running: true })
}

/**
 * Modifiche dalla pagina. body: { scope, drafts?, appendTurns?, updateTurn?: { id, actions }, handled?: jobId, clearTurns? }
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scope = asScope(body?.scope)
  if (!(await getStaffAccess(req)) || !(await authorized(req, scope, true))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const state = await updateState(scope, (s) => {
    if (Array.isArray(body?.drafts)) s.drafts = body.drafts.filter((d: { leadId?: unknown }) => typeof d?.leadId === 'string').slice(0, 80)
    if (Array.isArray(body?.appendTurns)) {
      for (const t of body.appendTurns as Turn[]) {
        if ((t?.role === 'user' || t?.role === 'assistant') && typeof t?.text === 'string') s.turns.push({ id: newId(), role: t.role, text: t.text.slice(0, 4000) })
      }
    }
    if (body?.updateTurn?.id) {
      const turn = s.turns.find((t) => t.id === body.updateTurn.id)
      if (turn && Array.isArray(body.updateTurn.actions)) turn.actions = body.updateTurn.actions
    }
    if (body?.handled && s.job && s.job.id === body.handled) s.job.handled = true
    if (body?.clearTurns && !isRunning(s.job)) {
      s.turns = []
      s.job = null
    }
  })
  return NextResponse.json({ ...state, running: isRunning(state.job) })
}
